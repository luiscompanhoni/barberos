/**
 * Pagamento antecipado de horario avulso: o cliente paga por Pix ou cartao antes de vir
 * (Pagar.me: checkout do BarberOS com cartao tokenizado; Celcash: link do gateway). Pago, o valor entra sozinho na comanda do atendimento. Se o horario for
 * cancelado depois de pago, o valor vira saldo do cliente (usa na proxima visita).
 */
import type { FormaPagamento, PagamentoAntecipado, Prisma } from "@prisma/client";
import { auditar } from "@/lib/auditoria";
import { linkAbsoluto } from "@/lib/assinaturas/cobrancas";
import { cpfValido } from "@/lib/assinaturas/regras";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { pixVencido, validadePixSeg, type EstadoCheckout } from "@/lib/pagamentos/checkout-regras";
import { gateway, gatewayPorId } from "@/lib/pagamentos/gateway";
import { notificarEmSegundoPlano } from "@/lib/whatsapp/conversas";
import { configuracao } from "./carregar";
import { dataLocal, minParaHhmm, minutosLocal } from "./tempo";

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
  return !!(await gateway()).criarCobrancaAvulsa;
}

/** Pagina do checkout do BarberOS para pagar o horario (area do cliente). */
export const caminhoCheckoutHorario = (agendamentoId: string) => `/c/pagar-horario/${agendamentoId}`;

function resposta(a: PagamentoAntecipado) {
  return {
    id: a.id, status: a.status, forma: a.forma, valorCentavos: a.valorCentavos,
    link: linkAbsoluto(a.link), pixCopiaECola: a.pixCopiaECola, pixQrUrl: a.pixQrUrl, pixExpiraEm: a.pixExpiraEm, pagoEm: a.pagoEm,
  };
}

/** Estado para a tela do checkout. */
export function estadoCheckoutAntecipado(a: PagamentoAntecipado | null): EstadoCheckout {
  if (!a) return { status: "PENDENTE", forma: null, pix: null, link: null };
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

/** Gera (ou reaproveita) o link para o cliente pagar o horario agora. */
export async function pagarAntecipado(p: {
  clienteId: string; agendamentoId: string; forma: FormaPagamento; cpf?: string; email?: string; usuarioId?: string | null;
  /** Checkout do BarberOS: cartao tokenizado no navegador, cobrado na hora. */
  cartaoToken?: string;
}) {
  const g = await gateway();
  if (!g.criarCobrancaAvulsa) throw new ErroNegocio("O pagamento antecipado ainda não está disponível. Pague no balcão.", 409, "indisponivel");
  if (p.forma === "BOLETO") throw new ErroNegocio("Para pagar antes, use Pix ou cartão.", 422);

  const ag = await db.agendamento.findFirst({
    where: { id: p.agendamentoId, clienteId: p.clienteId },
    include: { servico: { select: { nome: true } }, barbeiro: { select: { nome: true } }, antecipado: true, itemComanda: { select: { id: true } } },
  });
  if (!ag) throw naoEncontrado("Horário");
  const motivo = motivoParaNaoPagar(ag);
  if (motivo) throw new ErroNegocio(motivo, 409, "nao_pode");
  if (ag.itemComanda) throw new ErroNegocio("Esse atendimento já está na comanda: pague no balcão.", 409, "na_comanda");

  let atual = ag.antecipado;
  if (atual?.status === "PENDENTE") atual = (await sincronizarAntecipado(atual.id)) ?? atual;
  if (atual?.status === "PAGO") throw new ErroNegocio("Esse horário já está pago. ✅", 409, "ja_pago");
  const tokenizado = g.cartao === "token" || !!p.cartaoToken;
  // Cartao no checkout do BarberOS ainda sem token: devolve a pagina do checkout (bot, botao "cartao").
  if (p.forma === "CARTAO" && g.cartao === "token" && !p.cartaoToken) {
    return {
      id: atual?.id ?? "", status: "PENDENTE" as const, forma: "CARTAO" as const, valorCentavos: ag.precoCentavos,
      link: linkAbsoluto(caminhoCheckoutHorario(ag.id)), pixCopiaECola: null, pixQrUrl: null, pixExpiraEm: null, pagoEm: null,
    };
  }
  const reaproveita = atual?.status === "PENDENTE" && atual.forma === p.forma && atual.valorCentavos === ag.precoCentavos && !!atual.link &&
    !p.cartaoToken && !(p.forma === "PIX" && pixVencido(atual.pixExpiraEm));
  if (reaproveita && atual) return resposta(atual);
  // Trocou a forma (ou o preco mudou, ou o Pix venceu): cancela o pagamento antigo antes de gerar outro.
  if (atual?.status === "PENDENTE" && atual.gatewayId) await (await gatewayPorId(atual.gatewayId)).cancelarCobrancaAvulsa?.(atual.gatewayId).catch(() => {});

  const cliente = await db.cliente.findUniqueOrThrow({ where: { id: p.clienteId } });
  const email = (p.email ?? cliente.email ?? "").trim().toLowerCase();
  if (g.exigeEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw new ErroNegocio("Para pagar online precisamos do seu e-mail (exigência do meio de pagamento).", 422, "email");
  }
  const cpf = (p.cpf ?? cliente.cpf ?? "").replace(/\D/g, "");
  if (!cpfValido(cpf)) throw new ErroNegocio("Para pagar online precisamos de um CPF válido (exigência do meio de pagamento).", 422, "cpf");
  if (cpf !== cliente.cpf || (email && email !== cliente.email)) {
    await db.cliente.update({ where: { id: cliente.id }, data: { cpf, ...(email ? { email } : {}) } });
  }

  const cfg = await configuracao();
  const quando = `${dataLocal(ag.inicio, cfg.fuso).split("-").reverse().slice(0, 2).join("/")} ${minParaHhmm(minutosLocal(ag.inicio, cfg.fuso))}`;
  let cob;
  try {
    const clienteGatewayId = await g.criarCliente({ nome: cliente.nome, cpf, telefone: cliente.telefone, email: email || null, referencia: cliente.id });
    cob = await g.criarCobrancaAvulsa({
      clienteGatewayId,
      valorCentavos: ag.precoCentavos,
      forma: p.forma,
      vencimento: dataLocal(ag.inicio, cfg.fuso),
      descricao: `${ag.servico.nome} com ${ag.barbeiro.nome} - ${quando} - ${cfg.nomeBarbearia}`,
      referencia: `ag-${ag.id}-${Date.now().toString(36)}`,
      ...(p.forma === "CARTAO" && p.cartaoToken ? { cartaoToken: p.cartaoToken, parcelas: 1 } : {}),
      // Pix vale 1 dia, sem passar do horario.
      ...(p.forma === "PIX" ? { pixValidadeSeg: validadePixSeg(ag.inicio) } : {}),
    });
  } catch (e) {
    console.error("[antecipado] falha no gateway:", e);
    if (p.cartaoToken) throw new ErroNegocio("O cartão não foi aceito. Confira os dados ou tente outro cartão.", 422, "cartao_recusado");
    throw new ErroNegocio("Não foi possível gerar o pagamento agora. Tente de novo em instantes.", 502, "gateway");
  }

  const recusado = !!p.cartaoToken && (cob.status === "ATRASADA" || cob.status === "CANCELADA");
  const dados = {
    clienteId: cliente.id, valorCentavos: ag.precoCentavos, forma: p.forma, status: recusado ? ("CANCELADO" as const) : ("PENDENTE" as const),
    gatewayId: cob.id,
    // No checkout do BarberOS o "link" e a propria pagina (o bot manda ela no WhatsApp).
    link: cob.link ?? (tokenizado ? caminhoCheckoutHorario(ag.id) : null),
    pixCopiaECola: cob.pixCopiaECola ?? null, pixQrUrl: cob.pixQrUrl ?? null, pixExpiraEm: cob.expiraEm ? new Date(cob.expiraEm) : null, pagoEm: null,
  };
  const a = await db.$transaction(async (tx) => {
    const salvo = await tx.pagamentoAntecipado.upsert({ where: { agendamentoId: ag.id }, create: { agendamentoId: ag.id, ...dados }, update: dados });
    await auditar(tx, p.usuarioId ?? null, "gerar_pagamento_antecipado", "agendamento", ag.id, { forma: p.forma, valorCentavos: ag.precoCentavos, recusado });
    return salvo;
  });
  if (recusado) throw new ErroNegocio(cob.erro ?? "O cartão não foi aceito. Confira os dados ou tente outro cartão.", 422, "cartao_recusado");
  // Cartao aprovado na hora: ja confirma (o webhook depois so repete).
  if (cob.status === "PAGA") {
    await marcarPago(a.id, cob.pagaEm);
    return resposta(await db.pagamentoAntecipado.findUniqueOrThrow({ where: { id: a.id } }));
  }
  return resposta(a);
}

/** Situacao do pagamento antecipado de um horario (consulta o gateway se ainda estiver em aberto). */
export async function antecipadoDoHorario(clienteId: string, agendamentoId: string) {
  const a = await db.pagamentoAntecipado.findFirst({ where: { agendamentoId, clienteId } });
  if (!a) return null;
  return resposta((await sincronizarAntecipado(a.id)) ?? a);
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

/** Pago no gateway: marca, lanca na comanda aberta (se ja tiver) ou credita se o horario caiu. */
async function marcarPago(id: string, pagoEm: string | null) {
  const r = await db.$transaction(async (tx) => {
    const ok = await tx.pagamentoAntecipado.updateMany({ where: { id, status: "PENDENTE" }, data: { status: "PAGO", pagoEm: pagoEm ? new Date(pagoEm) : new Date() } });
    if (!ok.count) return null;
    const a = await tx.pagamentoAntecipado.findUniqueOrThrow({
      where: { id },
      include: { agendamento: { include: { itemComanda: { include: { comanda: { select: { id: true, status: true } } } } } }, cliente: { select: { nome: true, telefone: true } } },
    });
    await auditar(tx, null, "pagamento_antecipado_recebido", "agendamento", a.agendamentoId, { valorCentavos: a.valorCentavos });
    if (a.agendamento.status === "CANCELADO") return { a, creditado: await creditar(tx, a) };
    const comanda = a.agendamento.itemComanda?.comanda;
    if (comanda?.status === "ABERTA") await aplicarNaComanda(tx, comanda.id, a);
    return { a, creditado: false, comandaId: comanda?.status === "ABERTA" ? comanda.id : null };
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
    if (c.status === "PAGA") await marcarPago(a.id, c.pagaEm);
    // Cancelado, ou cartao do checkout recusado depois da analise.
    else if (c.status === "CANCELADA" || (c.status === "ATRASADA" && g.cartao === "token")) {
      await db.pagamentoAntecipado.updateMany({ where: { id: a.id, status: "PENDENTE" }, data: { status: "CANCELADO" } });
    }
    else if (c.link !== a.link || (c.pixCopiaECola && c.pixCopiaECola !== a.pixCopiaECola)) {
      await db.pagamentoAntecipado.update({ where: { id: a.id }, data: { link: c.link ?? a.link, pixCopiaECola: c.pixCopiaECola ?? a.pixCopiaECola, pixQrUrl: c.pixQrUrl ?? a.pixQrUrl } });
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
    if (a.status === "PENDENTE") a = await sincronizarAntecipado(a.id); // pode ter pago agora ha pouco
    if (!a) return;
    if (a.status === "PENDENTE") {
      if (a.gatewayId) await (await gatewayPorId(a.gatewayId)).cancelarCobrancaAvulsa?.(a.gatewayId).catch(() => {});
      await db.pagamentoAntecipado.updateMany({ where: { id: a.id, status: "PENDENTE" }, data: { status: "CANCELADO" } });
      return;
    }
    if (a.status !== "PAGO") return;
    const id = a.id;
    const r = await db.$transaction(async (tx) => {
      const x = await tx.pagamentoAntecipado.findUniqueOrThrow({ where: { id }, include: { agendamento: true, pagamentoComanda: true, cliente: true } });
      if (x.pagamentoComanda) return null; // ja usado na comanda
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
