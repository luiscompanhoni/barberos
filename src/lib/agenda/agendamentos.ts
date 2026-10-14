import { aoCancelarHorario } from "./antecipado";
import { Prisma, type OrigemAgendamento, type StatusAgendamento } from "@prisma/client";
import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { publicar } from "@/lib/eventos";
import { exigirGestaoBarbeiro, type Sessao } from "@/lib/auth/sessao";
import { avisarMudanca } from "@/lib/whatsapp/avisos";
import { precificar } from "@/lib/assinaturas/agenda";
import { normalizarTelefone } from "@/lib/telefone";
import { carregarDia, configuracao, servicoDoBarbeiro } from "./carregar";
import { contido, sobrepoe, type Intervalo } from "./disponibilidade";
import { dataLocal, minParaHhmm, minutosLocal } from "./tempo";

const MIN = 60_000;

export const conflitoHorario = () =>
  new ErroNegocio("Esse horário acabou de ser ocupado. Escolha outro.", 409, "conflito_horario");

/** Violacao da exclusao "agendamentos_sem_sobreposicao" (corrida entre bot, site e recepcao). */
function ehConflitoNoBanco(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes("agendamentos_sem_sobreposicao") || msg.includes("23P01");
}

type Tx = Prisma.TransactionClient;

/** Serializa alteracoes na agenda de um barbeiro ate o fim da transacao. */
export async function travarBarbeiro(tx: Tx, barbeiroId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${barbeiroId}))`;
}

/**
 * Confere se [inicio, fim) cabe na agenda do barbeiro: dentro do expediente,
 * fora de bloqueios e sem encostar em outro atendimento (com o intervalo entre
 * clientes). O banco ainda garante a nao sobreposicao como ultima barreira.
 */
export async function validarEncaixe(
  tx: Tx,
  barbeiroId: string,
  int: Intervalo,
  opts: { fuso: string; intervaloEntreClientes: number; ignorarAgendamentoId?: string },
) {
  await travarBarbeiro(tx, barbeiroId);
  const data = dataLocal(int.inicio, opts.fuso);
  if (dataLocal(int.fim - 1, opts.fuso) !== data) {
    throw new ErroNegocio("O atendimento precisa começar e terminar no mesmo dia.");
  }
  const dia = (await carregarDia(data, [barbeiroId], { fuso: opts.fuso, ignorarAgendamentoId: opts.ignorarAgendamentoId, c: tx })).get(barbeiroId)!;

  if (!contido(int, dia.janelas)) {
    throw new ErroNegocio(
      `Fora do expediente do barbeiro (${minParaHhmm(minutosLocal(int.inicio, opts.fuso))}). ` +
        "Ajuste o expediente do dia antes de encaixar.",
      422,
      "fora_expediente",
    );
  }
  const bloqueio = dia.bloqueios.find((b) => sobrepoe(b, int));
  if (bloqueio) {
    throw new ErroNegocio(`Agenda fechada nesse horário${bloqueio.motivo ? ` (${bloqueio.motivo})` : ""}.`, 422, "agenda_fechada");
  }
  const folga = opts.intervaloEntreClientes * MIN;
  if (dia.agendamentos.some((a) => sobrepoe({ inicio: a.inicio - folga, fim: a.fim + folga }, int))) {
    throw conflitoHorario();
  }
}

export type NovoAgendamento = {
  barbeiroId: string;
  servicoId: string;
  inicio: Date;
  /** Duracao diferente da padrao (so equipe). */
  duracaoMin?: number;
  cliente: { id: string } | { telefone: string; nome: string };
  origem: OrigemAgendamento;
  observacao?: string;
  semPreferencia?: boolean;
  /** Assinante aceitou pagar quando a regra do plano nao cobre. */
  forcarAvulso?: boolean;
};

export async function criarAgendamento(input: NovoAgendamento, ator: Sessao | null) {
  const cfg = await configuracao();
  const equipe = ator && ator.papel !== "CLIENTE";
  if (ator && equipe) exigirGestaoBarbeiro(ator, input.barbeiroId);

  const barbeiro = await db.barbeiro.findUnique({ where: { id: input.barbeiroId } });
  if (!barbeiro || !barbeiro.ativo) throw naoEncontrado("Barbeiro");
  const sb = await servicoDoBarbeiro(input.barbeiroId, input.servicoId);
  if (!sb) throw new ErroNegocio(`${barbeiro.nome} não faz esse serviço.`);

  const duracao = equipe && input.duracaoMin ? input.duracaoMin : sb.duracaoMin;
  const int = { inicio: input.inicio.getTime(), fim: input.inicio.getTime() + duracao * MIN };

  // Cliente marcando sozinho (bot/site) respeita antecedencia e janela.
  if (!equipe) {
    const agora = Date.now();
    if (int.inicio < agora + cfg.antecedenciaMinimaMin * MIN) {
      throw new ErroNegocio(`Agendamentos precisam de ${cfg.antecedenciaMinimaMin} min de antecedência.`);
    }
    if (int.inicio > agora + cfg.janelaAgendamentoDias * 24 * 60 * MIN) {
      throw new ErroNegocio(`Só é possível agendar até ${cfg.janelaAgendamentoDias} dias à frente.`);
    }
  }

  try {
    const ag = await db.$transaction(async (tx) => {
      await validarEncaixe(tx, input.barbeiroId, int, { fuso: cfg.fuso, intervaloEntreClientes: cfg.intervaloEntreClientes });
      const clienteId = await resolverCliente(tx, input.cliente);
      const preco = await precificar({
        clienteId, servicoId: input.servicoId, barbeiroId: input.barbeiroId, inicio: int.inicio,
        precoBase: sb.precoCentavos, fuso: cfg.fuso, forcarAvulso: input.forcarAvulso, c: tx,
      });
      const criado = await tx.agendamento.create({
        data: {
          barbeiroId: input.barbeiroId,
          clienteId,
          servicoId: input.servicoId,
          inicio: new Date(int.inicio),
          fim: new Date(int.fim),
          origem: input.origem,
          precoCentavos: preco.precoCentavos,
          assinaturaId: preco.assinaturaId,
          observacao: input.observacao,
          semPreferencia: input.semPreferencia ?? false,
          criadoPorId: ator?.usuarioId,
        },
      });
      await auditar(tx, ator?.usuarioId ?? null, "criar", "agendamento", criado.id, {
        inicio: criado.inicio.toISOString(),
        barbeiroId: criado.barbeiroId,
        origem: criado.origem,
      });
      return criado;
    });
    publicar({ tipo: "agenda", barbeiroIds: [ag.barbeiroId], datas: [dataLocal(ag.inicio, cfg.fuso)] });
    return ag;
  } catch (e) {
    if (ehConflitoNoBanco(e)) throw conflitoHorario();
    throw e;
  }
}

async function resolverCliente(tx: Tx, c: NovoAgendamento["cliente"]): Promise<string> {
  if ("id" in c) {
    const existe = await tx.cliente.findUnique({ where: { id: c.id } });
    if (!existe) throw naoEncontrado("Cliente");
    return existe.id;
  }
  const telefone = normalizarTelefone(c.telefone);
  if (!telefone) throw new ErroNegocio("Telefone inválido. Use DDD + número.");
  const nome = c.nome.trim();
  const cli = await tx.cliente.upsert({
    where: { telefone },
    create: { telefone, nome: nome || "Cliente" },
    update: {},
  });
  return cli.id;
}

export type AlteracaoAgendamento = {
  inicio?: Date;
  fim?: Date;
  barbeiroId?: string;
  servicoId?: string;
};

/** Mover (arrastar), mudar duracao (esticar), trocar barbeiro ou servico. So equipe. */
export async function alterarAgendamento(id: string, mud: AlteracaoAgendamento, ator: Sessao) {
  const cfg = await configuracao();
  const atual = await db.agendamento.findUnique({ where: { id } });
  if (!atual) throw naoEncontrado("Agendamento");
  exigirGestaoBarbeiro(ator, atual.barbeiroId);
  if (atual.status === "CANCELADO") throw new ErroNegocio("Agendamento cancelado não pode ser alterado.");

  const barbeiroId = mud.barbeiroId ?? atual.barbeiroId;
  if (barbeiroId !== atual.barbeiroId) exigirGestaoBarbeiro(ator, barbeiroId);
  const servicoId = mud.servicoId ?? atual.servicoId;

  const sb = await servicoDoBarbeiro(barbeiroId, servicoId);
  if (!sb) throw new ErroNegocio("O barbeiro escolhido não faz esse serviço.");

  const inicio = (mud.inicio ?? atual.inicio).getTime();
  let duracao = atual.fim.getTime() - atual.inicio.getTime();
  if (mud.servicoId && mud.servicoId !== atual.servicoId) duracao = sb.duracaoMin * MIN;
  const fim = mud.fim ? mud.fim.getTime() : inicio + duracao;
  if (fim <= inicio) throw new ErroNegocio("O fim precisa ser depois do início.");
  if (fim - inicio > 8 * 60 * MIN) throw new ErroNegocio("Atendimento longo demais.");

  try {
    const ag = await db.$transaction(async (tx) => {
      await validarEncaixe(tx, barbeiroId, { inicio, fim }, {
        fuso: cfg.fuso,
        intervaloEntreClientes: cfg.intervaloEntreClientes,
        ignorarAgendamentoId: id,
      });
      const novo = await tx.agendamento.update({
        where: { id },
        data: {
          inicio: new Date(inicio),
          fim: new Date(fim),
          barbeiroId,
          servicoId,
          ...(servicoId !== atual.servicoId
            ? await (async () => {
                const pr = await precificar({
                  clienteId: atual.clienteId, servicoId, barbeiroId, inicio, precoBase: sb.precoCentavos,
                  fuso: cfg.fuso, forcarAvulso: true, ignorarAgendamentoId: id, c: tx,
                });
                return { precoCentavos: pr.precoCentavos, assinaturaId: pr.assinaturaId };
              })()
            : {}),
        },
      });
      await auditar(tx, ator.usuarioId, "alterar", "agendamento", id, {
        de: { inicio: atual.inicio.toISOString(), fim: atual.fim.toISOString(), barbeiroId: atual.barbeiroId },
        para: { inicio: novo.inicio.toISOString(), fim: novo.fim.toISOString(), barbeiroId },
      });
      return novo;
    });
    publicar({
      tipo: "agenda",
      barbeiroIds: [...new Set([atual.barbeiroId, ag.barbeiroId])],
      datas: [...new Set([dataLocal(atual.inicio, cfg.fuso), dataLocal(ag.inicio, cfg.fuso)])],
    });
    if (ag.inicio.getTime() !== atual.inicio.getTime()) void avisarMudanca(ag.id, "remarcado");
    else if (ag.barbeiroId !== atual.barbeiroId) void avisarMudanca(ag.id, "transferido");
    return ag;
  } catch (e) {
    if (ehConflitoNoBanco(e)) throw conflitoHorario();
    throw e;
  }
}

export async function alterarStatus(id: string, status: StatusAgendamento, ator: Sessao) {
  const cfg = await configuracao();
  const atual = await db.agendamento.findUnique({ where: { id } });
  if (!atual) throw naoEncontrado("Agendamento");
  exigirGestaoBarbeiro(ator, atual.barbeiroId);
  if (atual.status === status) return atual;

  try {
    const ag = await db.$transaction(async (tx) => {
      const novo = await tx.agendamento.update({ where: { id }, data: { status } });
      // Servico adicional da comanda acompanha o atendimento principal (concluiu, faltou, cancelou...).
      await tx.agendamento.updateMany({ where: { adicionalDeId: id }, data: { status } });
      await auditar(tx, ator.usuarioId, "status", "agendamento", id, { de: atual.status, para: status });
      return novo;
    });
    publicar({ tipo: "agenda", barbeiroIds: [ag.barbeiroId], datas: [dataLocal(ag.inicio, cfg.fuso)] });
    if (status === "CANCELADO") {
      void avisarMudanca(ag.id, "cancelado");
      void aoCancelarHorario(ag.id);
    }
    return ag;
  } catch (e) {
    // Reativar um cancelado cujo horario ja foi ocupado.
    if (ehConflitoNoBanco(e)) throw conflitoHorario();
    throw e;
  }
}
