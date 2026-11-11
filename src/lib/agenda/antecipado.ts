/**
 * Pagamento antecipado de horario avulso: o cliente paga por Pix ou cartao antes de vir
 * (Pagar.me: checkout do BarberOS com cartao tokenizado; Celcash: link do gateway). Pago, o valor entra sozinho na comanda do atendimento. Se o horario for
 * cancelado depois de pago, o valor vira saldo do cliente (usa na proxima visita).
 */
import type { FormaPagamento, PagamentoAntecipado, Prisma } from "@prisma/client";
import { auditar } from "@/lib/auditoria";
import { linkAbsoluto } from "@/lib/assinaturas/cobrancas";
import { db } from "@/lib/db";
import { cancelamentoSemRecebimento } from "@/lib/assinaturas/operacao-inicial";
import type { EstadoCheckout } from "@/lib/pagamentos/checkout-regras";
import { gateway, gatewayPorId } from "@/lib/pagamentos/gateway";
import { cobrancasReaisBloqueadas } from "@/lib/pagamentos/bloqueio-cobranca";
import { notificarEmSegundoPlano } from "@/lib/whatsapp/conversas";
import { configuracao } from "./carregar";
import { dataLocal } from "./tempo";
import { travarBarbeiro } from "./agendamentos";

type Tx = Prisma.TransactionClient;
const reais = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Motivo para nao poder pagar antes (ou null se pode). */
export function motivoParaNaoPagar(ag: { status: string; assinaturaId: string | null; precoCentavos: number; inicio: Date }, agora = Date.now()) {
  if (ag.status !== "MARCADO" && ag.status !== "CONFIRMADO") return "Esse horário não está mais marcado.";
  if (ag.assinaturaId) return "Esse horário é pelo plano: não tem nada a pagar.";
  if (ag.precoCentavos <= 0) return "Esse horário não tem valor a pagar.";
  if (ag.inicio.getTime() <= agora) return "Esse horário já começou: pague no balcão.";
  return null;
}

/** Pagamento antecipado ja disponivel no meio de pagamento configurado? */
export async function antecipadoDisponivel() {
  const g = await gateway();
  return !cobrancasReaisBloqueadas(g.nome) && !!g.criarCobrancaAvulsa;
}

/** Pagina do checkout do BarberOS para pagar o horario (area do cliente). */
export const caminhoCheckoutHorario = (agendamentoId: string) => `/c/pagar-horario/${agendamentoId}`;

export function respostaAntecipado(a: PagamentoAntecipado) {
  return {
    id: a.id, status: a.status, forma: a.forma, valorCentavos: a.valorCentavos,
    link: linkAbsoluto(a.link), pixCopiaECola: a.pixCopiaECola, pixQrUrl: a.pixQrUrl, pixExpiraEm: a.pixExpiraEm, pagoEm: a.pagoEm,
  };
}

/** Estado para a tela do checkout. */
export function estadoCheckoutAntecipado(a: PagamentoAntecipado | null): EstadoCheckout {
  if (!a) return { status: "PENDENTE", forma: null, pix: null, link: null };
  if (a.emissaoChave) return { status: "PENDENTE", forma: a.forma === "BOLETO" ? null : a.forma, pix: null, link: null, processando: true, mensagem: "Pagamento em conferência. Aguarde o resultado antes de tentar novamente." };
  // Tentativa cancelada (Pix trocado, cartao recusado) nao fecha o checkout: da para tentar de novo.
  if (a.status === "CANCELADO") return { status: "PENDENTE", forma: null, pix: null, link: null };
  const status = a.status === "PAGO" || a.status === "CREDITADO" ? "PAGO" : "PENDENTE";
  const aberto = status === "PENDENTE";
  const pix = aberto && a.forma === "PIX" && a.pixCopiaECola
    ? { copiaECola: a.pixCopiaECola, qrUrl: a.pixQrUrl, expiraEm: a.pixExpiraEm?.toISOString() ?? null }
    : null;
  // Link externo so quando nao e o proprio checkout (ex.: pagina de teste do simulado).
  const externo = aberto && a.link && !a.link.startsWith("/c/pagar-horario/") ? linkAbsoluto(a.link) : null;
  return { status, forma: a.forma === "BOLETO" ? null : a.forma, pix, link: externo, processando: aberto && a.forma === "CARTAO" };
}

/** Emissão com claim durável; o total contempla o atendimento inteiro. */
export async function pagarAntecipado(p: {
  clienteId: string; agendamentoId: string; forma: FormaPagamento; cpf?: string; email?: string; usuarioId?: string | null; sessaoVersao?: number;
  cartaoToken?: string;
}) {
  return (await import("./antecipado-emissao")).emitirAntecipado(p);
}

/** Situacao do pagamento antecipado de um horario (consulta o gateway se ainda estiver em aberto). */
export async function antecipadoDoHorario(clienteId: string, agendamentoId: string) {
  const a = await db.pagamentoAntecipado.findFirst({ where: { agendamentoId, clienteId } });
  if (!a) return null;
  return respostaAntecipado((await sincronizarAntecipado(a.id)) ?? a);
}

/** Estado do checkout do horario (sincroniza se estiver em aberto). */
export async function checkoutDoHorario(clienteId: string, agendamentoId: string, sincronizar = true) {
  const a = await db.pagamentoAntecipado.findFirst({ where: { agendamentoId, clienteId } });
  return estadoCheckoutAntecipado(a && sincronizar ? ((await sincronizarAntecipado(a.id)) ?? a) : a);
}

/** Lanca o valor pago na comanda do atendimento (uma vez). */
export async function aplicarNaComanda(tx: Tx, comandaId: string, a: Pick<PagamentoAntecipado, "id" | "forma" | "valorCentavos" | "pagoEm">) {
  if (await tx.pagamentoComanda.findUnique({ where: { antecipadoId: a.id } })) return false;
  await tx.pagamentoComanda.create({
    data: {
      comandaId, antecipadoId: a.id, forma: a.forma === "CARTAO" ? "CREDITO" : "PIX", valorCentavos: a.valorCentavos,
      status: "PAGO", pagoEm: a.pagoEm ?? new Date(),
    },
  });
  return true;
}

/** Mesma ordem da abertura/cancelamento da comanda; recebimento também deve sobreviver à exclusão da ficha. */
async function travarAntecipado(tx: Tx, id: string) {
  const ref = await tx.pagamentoAntecipado.findUnique({ where: { id }, select: { clienteId: true, agendamento: { select: { barbeiroId: true } } } });
  if (!ref) return null;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cliente-ciclo:${ref.clienteId}`}))`;
  await travarBarbeiro(tx, ref.agendamento.barbeiroId);
  const a = await tx.pagamentoAntecipado.findUniqueOrThrow({ where: { id }, include: {
    agendamento: { include: { itemComanda: { include: { comanda: { select: { id: true, status: true } } } } } },
    pagamentoComanda: true, cliente: { select: { nome: true, telefone: true } },
  } });
  if (a.clienteId !== ref.clienteId || a.agendamento.clienteId !== ref.clienteId || a.agendamento.barbeiroId !== ref.agendamento.barbeiroId) return null;
  return a;
}

/** A prova pertence à tentativa consultada; uma resposta antiga nunca confirma a substituta. */
export async function marcarPago(id: string, pagoEm: string, prova: { gatewayId: string; valorCentavos: number }) {
  if (!Number.isFinite(Date.parse(pagoEm))) return;
  const r = await db.$transaction(async (tx) => {
    const a = await travarAntecipado(tx, id);
    if (!a) return null;
    const instante = new Date(pagoEm);
    const ok = await tx.pagamentoAntecipado.updateMany({ where: { id, status: "PENDENTE", emissaoChave: null, gatewayId: prova.gatewayId, valorCentavos: prova.valorCentavos }, data: { status: "PAGO", pagoEm: instante } });
    if (!ok.count) return null;
    const pago = { ...a, status: "PAGO" as const, pagoEm: instante };
    await auditar(tx, null, "pagamento_antecipado_recebido", "agendamento", a.agendamentoId, { valorCentavos: a.valorCentavos, gatewayId: prova.gatewayId });
    if (a.agendamento.status === "CANCELADO" && !a.pagamentoComanda) return { a: pago, creditado: await creditar(tx, pago) };
    const comanda = a.agendamento.itemComanda?.comanda;
    if (comanda?.status === "ABERTA") await aplicarNaComanda(tx, comanda.id, pago);
    return { a: pago, creditado: false, comandaId: comanda?.status === "ABERTA" ? comanda.id : null };
  });
  if (!r) return;
  if ("comandaId" in r && r.comandaId) (await import("@/lib/comandas/servico")).avisarComanda(r.comandaId);
  const nome = r.a.cliente.nome.split(" ")[0];
  notificarEmSegundoPlano(
    r.a.cliente.telefone,
    r.creditado
      ? `Oi, ${nome}! Recebemos ${reais(r.a.valorCentavos)}, mas o horário já tinha sido cancelado: o valor ficou como saldo pra sua próxima visita. 💈`
      : `Oi, ${nome}! Recebemos o pagamento de ${reais(r.a.valorCentavos)} do seu horário. Tá tudo certo, é só vir! 💈`,
  );
}

/** Horario cancelado depois de pago: o valor vira saldo do cliente. */
async function creditar(tx: Tx, a: PagamentoAntecipado & { agendamento: { inicio: Date } }) {
  const ok = await tx.pagamentoAntecipado.updateMany({ where: { id: a.id, status: "PAGO" }, data: { status: "CREDITADO" } });
  if (!ok.count) return false;
  const cfg = await configuracao();
  const dia = dataLocal(a.agendamento.inicio, cfg.fuso).split("-").reverse().slice(0, 2).join("/");
  await tx.beneficio.create({
    data: { clienteId: a.clienteId, descricao: `Horário pago e cancelado (${dia})`, valorCentavos: a.valorCentavos, motivo: "MANUAL" },
  });
  await auditar(tx, null, "pagamento_antecipado_creditado", "agendamento", a.agendamentoId, { valorCentavos: a.valorCentavos });
  return true;
}

/** Consulta o gateway e atualiza (pago, cancelado ou link novo). */
export async function sincronizarAntecipado(id: string) {
  const a = await db.pagamentoAntecipado.findUnique({ where: { id } });
  if (!a || a.status !== "PENDENTE" || !a.gatewayId) return a;
  // O gateway e o do registro (pagamentos antigos da Celcash continuam na Celcash).
  const g = await gatewayPorId(a.gatewayId);
  if (!g.buscarCobrancaAvulsa) return a;
  try {
    const c = await g.buscarCobrancaAvulsa(a.gatewayId);
    if (c.id !== a.gatewayId || c.valorCentavos !== a.valorCentavos || c.moeda !== "BRL") return a;
    const tentativa = { id: a.id, status: "PENDENTE" as const, emissaoChave: null, gatewayId: a.gatewayId, valorCentavos: a.valorCentavos };
    if (c.status === "PAGA" && c.liquidadoCentavos === a.valorCentavos && c.pagaEm && Number.isFinite(Date.parse(c.pagaEm))) await marcarPago(a.id, c.pagaEm, { gatewayId: a.gatewayId, valorCentavos: a.valorCentavos });
    // Cancelado, ou cartao do checkout recusado depois da analise.
    else if (cancelamentoSemRecebimento(c, a.gatewayId, a.valorCentavos) ||
      (a.forma === "CARTAO" && c.status === "ATRASADA" && c.recusaComprovada === true && c.liquidadoCentavos === 0 && !c.pagaEm)) {
      await db.$transaction(async tx => {
        const r = await tx.pagamentoAntecipado.updateMany({ where: tentativa, data: { status: "CANCELADO" } });
        if (r.count) await auditar(tx, null, "pagamento_antecipado_cancelado", "agendamento", a.agendamentoId, { gatewayId: a.gatewayId, valorCentavos: a.valorCentavos });
      });
    }
    else if (c.link !== a.link || (c.pixCopiaECola && c.pixCopiaECola !== a.pixCopiaECola)) {
      await db.pagamentoAntecipado.updateMany({ where: tentativa, data: { link: c.link ?? a.link, pixCopiaECola: c.pixCopiaECola ?? a.pixCopiaECola, pixQrUrl: c.pixQrUrl ?? a.pixQrUrl } });
    }
  } catch (e) {
    console.error(`[antecipado] falha ao consultar ${a.gatewayId}:`, e);
  }
  return db.pagamentoAntecipado.findUnique({ where: { id } });
}

/** Chamado depois de cancelar um horario: cancela o link em aberto ou credita o que ja foi pago. */
export async function aoCancelarHorario(agendamentoId: string) {
  try {
    let a = await db.pagamentoAntecipado.findUnique({ where: { agendamentoId } });
    if (!a) return;
    if (a.emissaoChave) return; // Emissão ainda em voo: o retorno tratará o cancelamento.
    if (a.status === "PENDENTE") a = await sincronizarAntecipado(a.id); // pode ter pago agora ha pouco
    if (!a) return;
    if (a.status === "PENDENTE") {
      if (!a.gatewayId) return;
      const g = await gatewayPorId(a.gatewayId);
      // DELETE em um provedor real pode devolver um pagamento recém-recebido.
      // Conserva a pendência até haver prova consultável de encerramento sem recebimento.
      if (g.nome === "simulado") await g.cancelarCobrancaAvulsa?.(a.gatewayId);
      const c = await g.buscarCobrancaAvulsa?.(a.gatewayId);
      if (c && cancelamentoSemRecebimento(c, a.gatewayId, a.valorCentavos)) await sincronizarAntecipado(a.id);
      else if (c?.status === "PAGA") await sincronizarAntecipado(a.id);
      return;
    }
    if (a.status !== "PAGO") return;
    const id = a.id;
    const r = await db.$transaction(async (tx) => {
      const x = await travarAntecipado(tx, id);
      if (!x || x.agendamento.status !== "CANCELADO" || x.pagamentoComanda) return null; // já usado ou horário reativado
      return (await creditar(tx, x)) ? x : null;
    });
    if (r) {
      notificarEmSegundoPlano(r.cliente.telefone, `Oi, ${r.cliente.nome.split(" ")[0]}! Como o horário foi cancelado, os ${reais(r.valorCentavos)} que você pagou ficaram como saldo pra próxima visita. 💈`);
    }
  } catch (e) {
    console.error("[antecipado] falha ao tratar cancelamento:", agendamentoId, e);
  }
}

/** Rotina: confere os pagamentos em aberto (o gateway pode nao avisar por webhook). */
export async function sincronizarAntecipadosPendentes() {
  const pendentes = await db.pagamentoAntecipado.findMany({
    where: { status: "PENDENTE", criadoEm: { gt: new Date(Date.now() - 45 * 86_400_000) } },
    select: { id: true },
  });
  for (const p of pendentes) await sincronizarAntecipado(p.id);
  return pendentes.length;
}
