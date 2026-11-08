import { aoCancelarHorario } from "./antecipado";
import { Prisma, type StatusAgendamento } from "@prisma/client";
import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { publicar } from "@/lib/eventos";
import { exigirPermissao } from "@/lib/auth/permissoes";
import { validarCadeira } from "./cadeiras";
import { grupoTemComanda } from "./grupo-comanda";
import { conferirSemReservaAdicional } from "./reservas-adicionais";
import { validarHorarioCliente } from "./cliente-conflitos";
import { erroDuracao } from "./encaixes-regras";
import { exigirGestaoBarbeiro, type Sessao } from "@/lib/auth/sessao";
import { avisarMudanca } from "@/lib/whatsapp/avisos";
import { precificar } from "@/lib/assinaturas/agenda";
import { resolverClienteAgenda, travarClienteAgenda } from "./cliente-identidade";
import { reservarPremio } from "@/lib/jogos/premios";
import { carregarDia, configuracao, servicoDoBarbeiro, STATUS_ATIVOS } from "./carregar";
import { contido, sobrepoe, type Intervalo } from "./disponibilidade";
import { dataLocal, minParaHhmm, minutosLocal, recusaOutroDia, recusaRetroativo } from "./tempo";
import { checarTransicaoNaReserva } from "./transicao";
import { concluirPedido, validarPedidoReserva } from "./pedidos-reserva";
import { revalidarCoberturaEquipe } from "./cobertura-equipe";
import type { NovoAgendamento, AlteracaoAgendamento } from "./agendamentos-tipos";
export type { NovoAgendamento, AlteracaoAgendamento } from "./agendamentos-tipos";
const MIN = 60_000;
export const conflitoHorario = () =>
  new ErroNegocio("Esse horário acabou de ser ocupado. Escolha outro.", 409, "conflito_horario");
function ehConflitoNoBanco(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes("agendamentos_sem_sobreposicao") || msg.includes("23P01");
}

type Tx = Prisma.TransactionClient;

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
  opts: { fuso: string; intervaloEntreClientes: number; ignorarAgendamentoId?: string; ignorarAgendamentoIds?: string[] },
) {
  await travarBarbeiro(tx, barbeiroId);
  const profissional = await tx.barbeiro.findFirst({ where: { id: barbeiroId, ativo: true }, select: { id: true, usuarioId: true } });
  if (!profissional) throw new ErroNegocio("O barbeiro está inativo.", 409);
  if (profissional.usuarioId && await tx.entrevistaRecrutamento.findFirst({ where: { donoId: profissional.usuarioId, estado: "CONFIRMADA", inicio: { lt: new Date(int.fim) }, fim: { gt: new Date(int.inicio) } }, select: { id: true } })) throw new ErroNegocio("O profissional tem uma entrevista confirmada nesse horário.", 409, "conflito_entrevista");
  const data = dataLocal(int.inicio, opts.fuso);
  if (dataLocal(int.fim - 1, opts.fuso) !== data) {
    throw new ErroNegocio("O atendimento precisa começar e terminar no mesmo dia.");
  }
  const dia = (await carregarDia(data, [barbeiroId], { fuso: opts.fuso, ignorarAgendamentoId: opts.ignorarAgendamentoId, ignorarAgendamentoIds: opts.ignorarAgendamentoIds, c: tx })).get(barbeiroId)!;

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


export async function criarAgendamento(input: NovoAgendamento, ator: Sessao | null) {
  const cfg = await configuracao();
  const equipe = ator && ator.papel !== "CLIENTE";
  const autoatendimento = !equipe || !!input.pedidoId;
  if (ator && equipe) exigirGestaoBarbeiro(ator, input.barbeiroId);

  const barbeiro = await db.barbeiro.findUnique({ where: { id: input.barbeiroId } });
  if (!barbeiro || !barbeiro.ativo) throw naoEncontrado("Barbeiro");
  const sb = await servicoDoBarbeiro(input.barbeiroId, input.servicoId);
  if (!sb) throw new ErroNegocio(`${barbeiro.nome} não faz esse serviço.`);
  const idsAdicionais = input.servicosAdicionais ?? [];
  if (idsAdicionais.length > 9 || new Set([input.servicoId, ...idsAdicionais]).size !== idsAdicionais.length + 1) throw new ErroNegocio("Selecione serviços diferentes.");
  const adicionais = await Promise.all(idsAdicionais.map((id) => servicoDoBarbeiro(input.barbeiroId, id)));
  if (adicionais.some((a) => !a)) throw new ErroNegocio(`${barbeiro.nome} não realiza todos os serviços escolhidos.`);

  const duracao = equipe && input.duracaoMin !== undefined ? input.duracaoMin : sb.duracaoMin + adicionais.reduce((s, a) => s + (a?.duracaoMin ?? 0), 0);
  if (input.duracaoEsperadaMin !== undefined && duracao !== input.duracaoEsperadaMin) throw new ErroNegocio("A duração mudou. Consulte a prévia e confira novamente a agenda principal.", 409, "duracao_alterada");
  if (equipe && input.duracaoMin !== undefined && duracao !== sb.duracaoMin) await exigirPermissao(ator, "duracao");
  const erro = erroDuracao(duracao, sb.minimoDuracaoMin);
  if (erro) throw new ErroNegocio(erro);
  const cadeiraId = equipe && input.cadeiraId !== undefined ? input.cadeiraId : barbeiro.cadeiraId;
  const int = { inicio: input.inicio.getTime(), fim: input.inicio.getTime() + duracao * MIN };
  if (input.realizado) {
    const recusa = recusaRetroativo(ator?.papel ?? "CLIENTE", int.inicio, int.fim, Date.now(), cfg.fuso);
    if (recusa) throw new ErroNegocio(recusa);
  }

  // Cliente marcando sozinho (bot/site) respeita antecedencia e janela.
  if (autoatendimento) {
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
      const clienteId = await resolverClienteAgenda(tx, input.cliente, input.titular);
      if (input.pedidoId) {
        if (!("id" in input.cliente)) throw new ErroNegocio("Pedido sem cliente vinculado.");
        const anterior = await validarPedidoReserva(tx, input.pedidoId, ator, { clienteId: input.cliente.id, barbeiroId: input.barbeiroId, servicoIds: [input.servicoId, ...idsAdicionais], inicio: input.inicio });
        if (anterior) return anterior;
      }
      if (!equipe) await checarTransicaoNaReserva(tx);
      await validarEncaixe(tx, input.barbeiroId, int, { fuso: cfg.fuso, intervaloEntreClientes: cfg.intervaloEntreClientes });
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cliente:${clienteId}`}))`;
      if (autoatendimento) {
        const futuros = await tx.agendamento.count({ where: { clienteId, adicionalDeId: null, status: { in: ["MARCADO", "CONFIRMADO"] }, fim: { gt: new Date() } } });
        if (futuros >= cfg.maxAgendamentosCliente) throw new ErroNegocio("Você atingiu o limite de horários marcados.", 422, "limite_cliente");
      }
      if (!input.realizado) await validarHorarioCliente(tx, clienteId, int);
      await validarCadeira(tx, cadeiraId, int, undefined, cfg.intervaloEntreClientes); // Ordem: barbeiro, cliente, cadeira.
      const sbAtual = await servicoDoBarbeiro(input.barbeiroId, input.servicoId, tx);
      if (!sbAtual || sbAtual.duracaoMin !== sb.duracaoMin || sbAtual.precoCentavos !== sb.precoCentavos) throw new ErroNegocio("O serviço foi alterado. Consulte o horário e valor novamente.", 409, "servico_alterado");
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
      let inicioAdicional = int.inicio + sb.duracaoMin * MIN;
      let totalCentavos = preco.precoCentavos;
      const agendamentoIds = [criado.id];
      for (let i = 0; i < idsAdicionais.length; i++) {
        const item = await servicoDoBarbeiro(input.barbeiroId, idsAdicionais[i], tx);
        if (!item || item.duracaoMin !== adicionais[i]?.duracaoMin) throw conflitoHorario();
        const precoItem = await precificar({ clienteId, servicoId: idsAdicionais[i], barbeiroId: input.barbeiroId, inicio: inicioAdicional,
          precoBase: item.precoCentavos, fuso: cfg.fuso, forcarAvulso: input.forcarAvulso, c: tx });
        totalCentavos += precoItem.precoCentavos;
        const fimItem = inicioAdicional + item.duracaoMin * MIN;
        const adicional = await tx.agendamento.create({ data: { barbeiroId: input.barbeiroId, clienteId, servicoId: idsAdicionais[i],
          inicio: new Date(inicioAdicional), fim: new Date(fimItem), origem: input.origem, precoCentavos: precoItem.precoCentavos,
          assinaturaId: precoItem.assinaturaId, adicionalDeId: criado.id, semPreferencia: input.semPreferencia ?? false } });
        agendamentoIds.push(adicional.id);
        inicioAdicional = fimItem;
      }
      if (input.precoEsperadoCentavos !== undefined && input.precoEsperadoCentavos !== totalCentavos) throw new ErroNegocio("O valor mudou. Consulte o horário e confirme novamente.", 409, "preco_alterado");
      if (input.premioId) await reservarPremio(tx, clienteId, input.premioId, criado);
      if (input.pedidoId) await concluirPedido(tx, input.pedidoId, ator!.usuarioId, agendamentoIds);
      await auditar(tx, ator?.usuarioId ?? null, "criar", "agendamento", criado.id, {
        inicio: criado.inicio.toISOString(),
        barbeiroId: criado.barbeiroId,
        origem: criado.origem,
        servicos: [input.servicoId, ...idsAdicionais],
        totalCentavos,
        avulsoAceito: input.forcarAvulso === true,
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


export async function alterarAgendamento(id: string, mud: AlteracaoAgendamento, ator: Sessao) {
  const cfg = await configuracao();
  const atual = await db.agendamento.findUnique({ where: { id } });
  if (!atual) throw naoEncontrado("Agendamento");
  if (atual.adicionalDeId && atual.origem === "SITE") throw new ErroNegocio("Este serviço pertence a um agendamento em grupo. Altere o horário principal.", 422, "alteracao_multiplos");
  if (await db.agendamento.count({ where: { adicionalDeId: id, origem: "SITE", status: { not: "CANCELADO" } } })) {
    throw new ErroNegocio("Este horário tem serviços agendados em conjunto. Cancele e reagende todos os serviços para alterar o horário.", 422, "alteracao_multiplos");
  }
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
      await travarClienteAgenda(tx, atual.clienteId);
      for (const b of [...new Set([atual.barbeiroId, barbeiroId])].sort()) await travarBarbeiro(tx, b);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cliente:${atual.clienteId}`}))`;
      const vigente = await tx.agendamento.findUniqueOrThrow({ where: { id } });
      if (+vigente.inicio !== +atual.inicio || +vigente.fim !== +atual.fim || vigente.status !== atual.status || vigente.barbeiroId !== atual.barbeiroId || vigente.cadeiraId !== atual.cadeiraId) throw conflitoHorario();
      await conferirSemReservaAdicional(tx, id, vigente.ocupaAgenda);
      await validarHorarioCliente(tx, atual.clienteId, { inicio, fim }, [id]);
      if (vigente.adicionalDeId && vigente.origem === "SITE" || await tx.agendamento.count({ where: { adicionalDeId: id, origem: "SITE", status: { not: "CANCELADO" } } })) throw new ErroNegocio("Este horário tem serviços agendados em conjunto. Cancele e reagende todos os serviços para alterar o horário.", 422, "alteracao_multiplos");
      await validarEncaixe(tx, barbeiroId, { inicio, fim }, {
        fuso: cfg.fuso,
        intervaloEntreClientes: cfg.intervaloEntreClientes,
        ignorarAgendamentoId: id,
      });
      await validarCadeira(tx, cadeiraId, { inicio, fim }, id, cfg.intervaloEntreClientes);
      if (servicoId === vigente.servicoId && (inicio !== +vigente.inicio || barbeiroId !== vigente.barbeiroId)) {
        await revalidarCoberturaEquipe(tx, vigente, { barbeiroId, inicio, fuso: cfg.fuso });
      }
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
  if (atual.adicionalDeId && atual.origem === "SITE") throw new ErroNegocio("Este serviço pertence a um agendamento em grupo. Altere o atendimento principal.", 422, "alteracao_multiplos");
  if (atual.status === status) return atual;
  // Criado depois de ja ter comecado (lancamento retroativo) e concluido em outro dia: mesma regra do "realizado".
  // Os marcados com antecedencia continuam com baixa normal (pendencia "sem baixa" dos ultimos dias).
  if (status === "CONCLUIDO" && +atual.criadoEm > +atual.inicio) {
    const recusa = recusaOutroDia(ator.papel, +atual.inicio, Date.now(), cfg.fuso);
    if (recusa) throw new ErroNegocio(recusa);
  }

  try {
    const ag = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cliente-ciclo:${atual.clienteId}`}))`;
      await travarBarbeiro(tx, atual.barbeiroId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cliente:${atual.clienteId}`}))`;
      const vigente = await tx.agendamento.findUniqueOrThrow({ where: { id } });
      if (vigente.status !== atual.status || +vigente.inicio !== +atual.inicio || +vigente.fim !== +atual.fim || vigente.barbeiroId !== atual.barbeiroId) throw conflitoHorario();
      if (vigente.adicionalDeId && vigente.origem === "SITE") throw new ErroNegocio("Este serviço pertence a um agendamento em grupo. Altere o atendimento principal.", 422, "alteracao_multiplos");
      if (vigente.status === "CANCELADO" && status !== "CANCELADO" && await tx.agendamento.count({ where: { adicionalDeId: id, origem: "SITE" } })) throw new ErroNegocio("Este grupo foi cancelado. Agende novamente todos os serviços.", 422, "alteracao_multiplos");
      if (vigente.ocupaAgenda && vigente.status === "CANCELADO") throw new ErroNegocio("Este adicional foi removido ou sua comanda foi cancelada. Lance um novo serviço na comanda aberta.", 409, "adicional_cancelado");
      if (vigente.ocupaAgenda && status === "CANCELADO") throw new ErroNegocio("Remova o serviço pela comanda para manter horário, itens e pagamentos coerentes.", 409, "adicional_na_comanda");
      if (vigente.ocupaAgenda) {
        const item = await tx.itemComanda.findUnique({ where: { agendamentoId: id }, select: { comanda: { select: { status: true } } } });
        if (item?.comanda.status !== "ABERTA") throw new ErroNegocio("O adicional não está em uma comanda aberta. Revise o vínculo antes de alterar o atendimento.", 409, "comanda_encerrada");
      }
      if (status === "CANCELADO" && await grupoTemComanda(tx, id, { somenteSeGrupo: true, adicionalDeId: vigente.adicionalDeId })) throw new ErroNegocio("Este grupo já tem comanda. Resolva a comanda antes de cancelar o atendimento.", 409, "comanda_existente");
      if ((STATUS_ATIVOS as readonly string[]).includes(status) && (!(STATUS_ATIVOS as readonly string[]).includes(vigente.status) ||
          ["MARCADO", "CONFIRMADO"].includes(status) && !["MARCADO", "CONFIRMADO"].includes(vigente.status))) {
        await travarClienteAgenda(tx, vigente.clienteId);
        await revalidarCoberturaEquipe(tx, vigente, { barbeiroId: vigente.barbeiroId, inicio: +vigente.inicio, fuso: cfg.fuso });
      }
      if ((STATUS_ATIVOS as readonly string[]).includes(status) && !(STATUS_ATIVOS as readonly string[]).includes(atual.status)) {
        await validarEncaixe(tx, atual.barbeiroId, { inicio: +atual.inicio, fim: +atual.fim }, { fuso: cfg.fuso, intervaloEntreClientes: cfg.intervaloEntreClientes, ignorarAgendamentoId: id });
        await validarCadeira(tx, atual.cadeiraId, { inicio: +atual.inicio, fim: +atual.fim }, id, cfg.intervaloEntreClientes);
      }
      const novo = await tx.agendamento.update({ where: { id }, data: { status } });
      // Servico adicional da comanda acompanha o atendimento principal (concluiu, faltou, cancelou...).
      await tx.agendamento.updateMany({ where: { adicionalDeId: id, ocupaAgenda: false, status: { not: "CANCELADO" } }, data: { status } });
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
