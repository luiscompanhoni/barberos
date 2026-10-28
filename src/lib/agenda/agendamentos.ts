import { aoCancelarHorario } from "./antecipado";
import { Prisma, type OrigemAgendamento, type StatusAgendamento } from "@prisma/client";
import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { publicar } from "@/lib/eventos";
import { exigirPermissao } from "@/lib/auth/permissoes";
import { validarCadeira } from "./cadeiras";
import { erroDuracao } from "./encaixes-regras";
import { exigirGestaoBarbeiro, type Sessao } from "@/lib/auth/sessao";
import { avisarMudanca } from "@/lib/whatsapp/avisos";
import { precificar } from "@/lib/assinaturas/agenda";
import { normalizarTelefone } from "@/lib/telefone";
import { carregarDia, configuracao, servicoDoBarbeiro, STATUS_ATIVOS } from "./carregar";
import { contido, sobrepoe, type Intervalo } from "./disponibilidade";
import { dataLocal, minParaHhmm, minutosLocal, recusaOutroDia, recusaRetroativo } from "./tempo";

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
  if (!(await tx.barbeiro.findFirst({ where: { id: barbeiroId, ativo: true }, select: { id: true } }))) throw new ErroNegocio("O barbeiro está inativo.", 409);
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
  cadeiraId?: string | null;
  cliente: { id: string } | { telefone: string; nome: string };
  origem: OrigemAgendamento;
  observacao?: string;
  semPreferencia?: boolean;
  /** Assinante aceitou pagar quando a regra do plano nao cobre. */
  forcarAvulso?: boolean;
  /** Equipe registrando um atendimento que já terminou. */
  realizado?: boolean;
};

export async function criarAgendamento(input: NovoAgendamento, ator: Sessao | null) {
  const cfg = await configuracao();
  const equipe = ator && ator.papel !== "CLIENTE";
  if (ator && equipe) exigirGestaoBarbeiro(ator, input.barbeiroId);

  const barbeiro = await db.barbeiro.findUnique({ where: { id: input.barbeiroId } });
  if (!barbeiro || !barbeiro.ativo) throw naoEncontrado("Barbeiro");
  const sb = await servicoDoBarbeiro(input.barbeiroId, input.servicoId);
  if (!sb) throw new ErroNegocio(`${barbeiro.nome} não faz esse serviço.`);

  const duracao = equipe && input.duracaoMin !== undefined ? input.duracaoMin : sb.duracaoMin;
  if (equipe && duracao !== sb.duracaoMin) await exigirPermissao(ator, "duracao");
  const erro = erroDuracao(duracao, sb.minimoDuracaoMin);
  if (erro) throw new ErroNegocio(erro);
  const cadeiraId = equipe && input.cadeiraId !== undefined ? input.cadeiraId : barbeiro.cadeiraId;
  const int = { inicio: input.inicio.getTime(), fim: input.inicio.getTime() + duracao * MIN };
  if (input.realizado) {
    const recusa = recusaRetroativo(ator?.papel ?? "CLIENTE", int.inicio, int.fim, Date.now(), cfg.fuso);
    if (recusa) throw new ErroNegocio(recusa);
  }

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
      await validarCadeira(tx, cadeiraId, int, undefined, cfg.intervaloEntreClientes);
      const clienteId = await resolverCliente(tx, input.cliente);
      const preco = await precificar({
        clienteId, servicoId: input.servicoId, barbeiroId: input.barbeiroId, inicio: int.inicio,
        precoBase: sb.precoCentavos, fuso: cfg.fuso, forcarAvulso: input.forcarAvulso, c: tx,
      });
      const criado = await tx.agendamento.create({
        data: {
          barbeiroId: input.barbeiroId,
          cadeiraId,
          clienteId,
          servicoId: input.servicoId,
          inicio: new Date(int.inicio),
          fim: new Date(int.fim),
          origem: input.origem,
          ...(input.realizado ? { status: "CONCLUIDO" as const } : {}),
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
        realizado: !!input.realizado,
      });
      return criado;
    });
    publicar({ tipo: "agenda", barbeiroIds: [ag.barbeiroId], datas: [dataLocal(ag.inicio, cfg.fuso)] });
    return ag;
  } catch (e) {
    if (ehConflitoNoBanco(e) || (e instanceof Error && e.message.includes("agendamentos_cadeira_sem_sobreposicao"))) throw conflitoHorario();
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
  cadeiraId?: string | null;
  motivo?: string;
};

/** Mover (arrastar), mudar duracao (esticar), trocar barbeiro ou servico. So equipe. */
export async function alterarAgendamento(id: string, mud: AlteracaoAgendamento, ator: Sessao) {
  const cfg = await configuracao();
  const atual = await db.agendamento.findUnique({ where: { id } });
  if (!atual) throw naoEncontrado("Agendamento");
  exigirGestaoBarbeiro(ator, atual.barbeiroId);
  if (["CANCELADO", "CONCLUIDO"].includes(atual.status)) throw new ErroNegocio("Atendimento concluído ou cancelado não pode ter horário alterado.");

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
  const erro = erroDuracao((fim - inicio) / MIN, sb.minimoDuracaoMin);
  if (erro) throw new ErroNegocio(erro);
  if (fim - inicio !== +atual.fim - +atual.inicio) await exigirPermissao(ator, "duracao");
  const destino = await db.barbeiro.findUniqueOrThrow({ where: { id: barbeiroId } });
  if (!destino.ativo) throw new ErroNegocio("O barbeiro está inativo.");
  const cadeiraId = mud.cadeiraId !== undefined ? mud.cadeiraId : barbeiroId === atual.barbeiroId ? atual.cadeiraId : destino.cadeiraId;

  try {
    const ag = await db.$transaction(async (tx) => {
      for (const b of [...new Set([atual.barbeiroId, barbeiroId])].sort()) await travarBarbeiro(tx, b);
      const vigente = await tx.agendamento.findUniqueOrThrow({ where: { id } });
      if (+vigente.inicio !== +atual.inicio || +vigente.fim !== +atual.fim || vigente.status !== atual.status || vigente.barbeiroId !== atual.barbeiroId || vigente.cadeiraId !== atual.cadeiraId) throw conflitoHorario();
      await validarEncaixe(tx, barbeiroId, { inicio, fim }, {
        fuso: cfg.fuso,
        intervaloEntreClientes: cfg.intervaloEntreClientes,
        ignorarAgendamentoId: id,
      });
      await validarCadeira(tx, cadeiraId, { inicio, fim }, id, cfg.intervaloEntreClientes);
      const novo = await tx.agendamento.update({
        where: { id },
        data: {
          cadeiraId,
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
        para: { inicio: novo.inicio.toISOString(), fim: novo.fim.toISOString(), barbeiroId, cadeiraId },
        motivo: mud.motivo ?? null,
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
    if (ehConflitoNoBanco(e) || (e instanceof Error && e.message.includes("agendamentos_cadeira_sem_sobreposicao"))) throw conflitoHorario();
    throw e;
  }
}

export async function alterarStatus(id: string, status: StatusAgendamento, ator: Sessao) {
  const cfg = await configuracao();
  const atual = await db.agendamento.findUnique({ where: { id } });
  if (!atual) throw naoEncontrado("Agendamento");
  exigirGestaoBarbeiro(ator, atual.barbeiroId);
  if (atual.status === status) return atual;
  // Criado depois de ja ter comecado (lancamento retroativo) e concluido em outro dia: mesma regra do "realizado".
  // Os marcados com antecedencia continuam com baixa normal (pendencia "sem baixa" dos ultimos dias).
  if (status === "CONCLUIDO" && +atual.criadoEm > +atual.inicio) {
    const recusa = recusaOutroDia(ator.papel, +atual.inicio, Date.now(), cfg.fuso);
    if (recusa) throw new ErroNegocio(recusa);
  }

  try {
    const ag = await db.$transaction(async (tx) => {
      await travarBarbeiro(tx, atual.barbeiroId);
      const vigente = await tx.agendamento.findUniqueOrThrow({ where: { id } });
      if (vigente.status !== atual.status || +vigente.inicio !== +atual.inicio || +vigente.fim !== +atual.fim || vigente.barbeiroId !== atual.barbeiroId) throw conflitoHorario();
      if ((STATUS_ATIVOS as readonly string[]).includes(status) && !(STATUS_ATIVOS as readonly string[]).includes(atual.status)) {
        await validarEncaixe(tx, atual.barbeiroId, { inicio: +atual.inicio, fim: +atual.fim }, { fuso: cfg.fuso, intervaloEntreClientes: cfg.intervaloEntreClientes, ignorarAgendamentoId: id });
        await validarCadeira(tx, atual.cadeiraId, { inicio: +atual.inicio, fim: +atual.fim }, id, cfg.intervaloEntreClientes);
      }
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
    if (ehConflitoNoBanco(e) || (e instanceof Error && e.message.includes("agendamentos_cadeira_sem_sobreposicao"))) throw conflitoHorario();
    throw e;
  }
}
