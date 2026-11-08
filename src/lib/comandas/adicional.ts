/**
 * Servico adicional na comanda (ex.: o cliente veio cortar e quer fazer a sobrancelha tambem).
 * Vira um atendimento ligado ao principal (comissao do barbeiro, uso do plano e relatorios contam normal),
 * Novos adicionais reservam horário próprio. Os registros antigos preservam seu comportamento.
 */
import { randomUUID } from "node:crypto";
import { auditar } from "@/lib/auditoria";
import { exigirGestaoBarbeiro, type Sessao } from "@/lib/auth/sessao";
import { precificar } from "@/lib/assinaturas/agenda";
import { configuracao, servicoDoBarbeiro } from "@/lib/agenda/carregar";
import { dataLocal } from "@/lib/agenda/tempo";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { publicar } from "@/lib/eventos";
import { descricaoServico } from "./regras";
import { validarEncaixe, conflitoHorario } from "@/lib/agenda/agendamentos";
import { validarCadeira } from "@/lib/agenda/cadeiras";
import { STATUS_ATIVOS } from "@/lib/agenda/carregar";
import { travarAgendaComanda } from "./agenda-comanda";
import { travarClienteAgenda } from "@/lib/agenda/cliente-identidade";
import { retomarSolicitacaoAdicional } from "./adicional-solicitacao";

const MIN = 60_000;

export async function adicionarServico(s: Sessao, comandaId: string, servicoId: string, barbeiroId: string, solicitacaoId: string = randomUUID()) {
  exigirGestaoBarbeiro(s, barbeiroId);
  const cfg = await configuracao();
  const r = await db.$transaction(async (tx) => {
    const anterior = await retomarSolicitacaoAdicional(tx, solicitacaoId, { comandaId, servicoId, barbeiroId, usuarioId: s.usuarioId });
    if (anterior) return anterior;
    const contexto = await travarAgendaComanda(tx, comandaId, barbeiroId);
    if (contexto.clienteId) await travarClienteAgenda(tx, contexto.clienteId);
    await tx.$queryRaw`SELECT 1 FROM comandas WHERE id = ${comandaId} FOR UPDATE`;
    const c = await tx.comanda.findUnique({ where: { id: comandaId }, include: { itens: { orderBy: { criadoEm: "asc" }, include: { agendamento: true } } } });
    if (!c) throw naoEncontrado("Comanda");
    if (c.status !== "ABERTA") throw new ErroNegocio("Essa comanda já foi fechada.");
    if (!c.clienteId) throw new ErroNegocio("Comanda sem cliente cadastrado: lance o serviço como item avulso.", 422, "sem_cliente");

    // Principal: o ultimo atendimento (nao adicional) da comanda; o adicional fica logo depois dele.
    const principal = c.itens.map((i) => i.agendamento).filter((a) => a && !a.adicionalDeId && !["CANCELADO", "FALTOU"].includes(a.status)).at(-1) ?? null;
    if (!principal) throw new ErroNegocio("Abra a comanda pelo atendimento da agenda para lançar um serviço junto.", 422, "sem_atendimento");
    if (principal.clienteId !== c.clienteId) throw new ErroNegocio("O cliente do atendimento difere da comanda. Revise o vínculo antes de adicionar serviços.", 409, "cliente_divergente");
    const profissional = await tx.barbeiro.findUnique({ where: { id: barbeiroId } });
    const atual = await servicoDoBarbeiro(barbeiroId, servicoId, tx);
    if (!profissional?.ativo) throw naoEncontrado("Barbeiro ativo");
    if (!atual) throw new ErroNegocio(`${profissional.nome} não faz esse serviço.`, 422, "servico_barbeiro");
    const grupo = await tx.agendamento.findMany({ where: { adicionalDeId: principal.id, status: { in: [...STATUS_ATIVOS] } }, select: { id: true, fim: true, ocupaAgenda: true } });
    const inicio = Math.max(Date.now(), +principal.fim, ...grupo.filter(a => a.ocupaAgenda).map(a => +a.fim));
    const fim = inicio + atual.duracaoMin * MIN;
    const ignorarIds = [principal.id, ...grupo.map(a => a.id)];
    await validarEncaixe(tx, barbeiroId, { inicio, fim }, { fuso: cfg.fuso, intervaloEntreClientes: cfg.intervaloEntreClientes, ignorarAgendamentoIds: ignorarIds });
    const choque = await tx.agendamento.findFirst({ where: { clienteId: c.clienteId, id: { notIn: ignorarIds }, OR: [{ adicionalDeId: null }, { ocupaAgenda: true }], status: { in: [...STATUS_ATIVOS] }, inicio: { lt: new Date(fim) }, fim: { gt: new Date(inicio) } }, select: { id: true } });
    if (choque) throw new ErroNegocio("O cliente já tem outro atendimento nesse período. Escolha outro horário antes de incluir o adicional.", 409, "choque_cliente");
    const cadeiraId = profissional.cadeiraId ?? (principal.barbeiroId === barbeiroId ? principal.cadeiraId : null);
    await validarCadeira(tx, cadeiraId, { inicio, fim }, undefined, cfg.intervaloEntreClientes, ignorarIds);
    // Assinante: o plano cobre se a regra deixar; senao sai avulso (com o desconto de assinante), sem travar o balcao.
    const preco = await precificar({
      clienteId: c.clienteId, servicoId, barbeiroId, inicio, precoBase: atual.precoCentavos, fuso: cfg.fuso, forcarAvulso: true, c: tx,
    });
    const ag = await tx.agendamento.create({
      data: {
        id: solicitacaoId,
        barbeiroId, cadeiraId, clienteId: c.clienteId, servicoId, inicio: new Date(inicio), fim: new Date(fim),
        status: "MARCADO", ocupaAgenda: true, origem: "RECEPCAO", precoCentavos: preco.precoCentavos, assinaturaId: preco.assinaturaId,
        adicionalDeId: principal.id, observacao: "Adicional lançado na comanda", criadoPorId: s.usuarioId,
      },
    });
    await tx.itemComanda.create({
      data: {
        comandaId, agendamentoId: ag.id, descricao: descricaoServico(atual.servico.nome, profissional.nome, !!preco.assinaturaId),
        quantidade: 1, precoUnitCentavos: preco.precoCentavos, barbeiroId,
      },
    });
    await auditar(tx, s.usuarioId, "servico_adicional", "comanda", comandaId, {
      comanda: c.numero, servico: atual.servico.nome, barbeiro: profissional.nome, precoCentavos: preco.precoCentavos, peloPlano: !!preco.assinaturaId, agendamentoId: ag.id, principalId: principal.id, ocupaAgenda: true, cadeiraId, inicio: ag.inicio.toISOString(), fim: ag.fim.toISOString(),
    });
    await auditar(tx, s.usuarioId, "criar_adicional", "solicitacao_adicional", solicitacaoId, { comandaId, servicoId, barbeiroId, principalId: principal.id, clienteId: c.clienteId });
    return ag;
  }).catch(e => { if (e instanceof Error && /agendamentos_(cadeira_)?sem_sobreposicao|23P01/.test(e.message)) throw conflitoHorario(); throw e; });
  publicar({ tipo: "comanda", comandaId });
  publicar({ tipo: "agenda", barbeiroIds: [barbeiroId], datas: [dataLocal(r.inicio, cfg.fuso)] });
  return r;
}

/** Item adicional tirado da comanda: o atendimento adicional e cancelado junto (dentro da transacao da remocao). */
export async function cancelarAdicionalDoItem(tx: Parameters<Parameters<typeof db.$transaction>[0]>[0], agendamentoId: string | null) {
  if (!agendamentoId) return;
  await tx.agendamento.updateMany({ where: { id: agendamentoId, adicionalDeId: { not: null } }, data: { status: "CANCELADO" } });
}
