/**
 * Fluxos de gateways que nao tem fatura hospedada (Pagar.me):
 * - cartao digitado na pagina do BarberOS e tokenizado no navegador;
 * - Pix gerado pelo BarberOS a cada mes.
 * - checkout do plano (/c/assinar/...): abas Cartao | Pix enquanto o 1o mes nao foi pago.
 */
import type { Cobranca } from "@prisma/client";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal } from "@/lib/agenda/tempo";
import type { EstadoCheckout } from "@/lib/pagamentos/checkout-regras";
import { pixVencido } from "@/lib/pagamentos/checkout-regras";
import { gateway, gatewayPorId } from "@/lib/pagamentos/gateway";
import { PREFIXO_PIX } from "@/lib/pagamentos/pagarme";
import { cobrancaEmAberto, sincronizarAssinatura, sincronizarCobranca } from "./cobrancas";
import { valorComRetencao } from "./retencao-regras";

/** Gera (e salva) a cobranca Pix de um mes da assinatura. */
export async function gerarPixDoMes(assinaturaId: string, vencimento: string) {
  const a = await db.assinatura.findUniqueOrThrow({ where: { id: assinaturaId }, include: { plano: true } });
  if (!a.gatewayId || !a.gatewayClienteId) throw new Error("Assinatura sem cadastro no meio de pagamento.");
  const g = await gatewayPorId(a.gatewayId);
  if (!g.criarCobrancaPix) throw new Error(`O gateway ${g.nome} não gera Pix avulso.`);
  const cfg = await configuracao();
  const cob = await g.criarCobrancaPix({
    clienteGatewayId: a.gatewayClienteId,
    // Desconto de retencao nas mensalidades cobertas.
    valorCentavos: valorComRetencao({
      precoCentavos: a.precoCentavos, vencimento,
      pct: a.descontoRetencaoPct, ate: a.descontoRetencaoAte?.toISOString().slice(0, 10) ?? null,
    }),
    vencimento,
    descricao: `${a.plano.nome} - ${cfg.nomeBarbearia}`,
    referencia: a.gatewayId,
    // Vale do dia em que e gerado ate o fim da tolerancia de atraso.
    validadeHoras: (cfg.toleranciaAtrasoDias + 4) * 24,
  });
  await sincronizarCobranca(cob);
  return db.cobranca.findUniqueOrThrow({ where: { gatewayId: cob.id } });
}

/** Pix expirado sem pagamento: cancela o antigo e gera outro para o mesmo mes. */
export async function renovarPixSeExpirado(cobrancaId: string) {
  const c = await db.cobranca.findUniqueOrThrow({ where: { id: cobrancaId } });
  if (c.forma !== "PIX" || c.status === "PAGA" || !c.expiraEm || c.expiraEm.getTime() > Date.now() + 3_600_000) return c;
  await db.cobranca.update({ where: { id: c.id }, data: { status: "CANCELADA" } });
  return gerarPixDoMes(c.assinaturaId, c.vencimento.toISOString().slice(0, 10));
}

async function assinaturaPorToken(tokenPublico: string) {
  const a = await db.assinatura.findUnique({ where: { tokenPublico }, include: { plano: true, cliente: true } });
  if (!a) throw naoEncontrado("Assinatura");
  return a;
}

/** Mensagem amigavel para recusa de cartao (o erro tecnico fica no log). */
function erroDeCartao(e: unknown) {
  console.error("[pagamentos] cartão:", e);
  return new ErroNegocio("O cartão não foi aceito. Confira os dados ou tente outro cartão.", 422, "cartao_recusado");
}

/** Assinatura Pix do checkout que ainda nao pagou o 1o mes (pode trocar para cartao). */
const pixPendente = (a: { status: string; gatewayId: string | null; formaPagamento: string }) =>
  a.status === "PENDENTE" && a.formaPagamento === "PIX" && !!a.gatewayId?.startsWith(PREFIXO_PIX);

/** Confere no gateway as cobrancas Pix em aberto (pode ter pago agora ha pouco). */
async function conferirPixEmAberto(assinaturaId: string) {
  const abertas = await db.cobranca.findMany({ where: { assinaturaId, status: { in: ["PENDENTE", "ATRASADA"] } } });
  for (const c of abertas) {
    try {
      await sincronizarCobranca(await (await gatewayPorId(c.gatewayId)).buscarCobranca(c.gatewayId));
    } catch (e) {
      console.error("[assinaturas] conferir Pix", c.gatewayId, e);
    }
  }
  return db.cobranca.findMany({ where: { assinaturaId, status: { in: ["PENDENTE", "ATRASADA"] } } });
}

/**
 * Primeiro pagamento no cartao: cria a assinatura na Pagar.me com o token
 * gerado no navegador. A primeira cobranca acontece na hora. Se o cliente tinha
 * escolhido Pix e ainda nao pagou, o Pix e cancelado e a assinatura vira cartao.
 */
export async function ativarComCartao(tokenPublico: string, cartaoToken: string) {
  let a = await assinaturaPorToken(tokenPublico);
  if (a.status === "CANCELADA") throw new ErroNegocio("Essa assinatura foi cancelada.");
  if (pixPendente(a)) {
    if (!a.plano.formasPagamento.includes("CARTAO")) throw new ErroNegocio("Esse plano não aceita cartão.");
    const abertas = await conferirPixEmAberto(a.id);
    if ((await db.assinatura.findUniqueOrThrow({ where: { id: a.id } })).status !== "PENDENTE") {
      throw new ErroNegocio("O Pix desse plano acabou de ser pago. ✅", 409, "ja_pago");
    }
    const g = await gatewayPorId(a.gatewayId!);
    for (const c of abertas) await g.cancelarCobranca?.(c.gatewayId).catch((e) => console.error("[assinaturas] cancelar Pix", c.gatewayId, e));
    await db.cobranca.updateMany({ where: { id: { in: abertas.map((c) => c.id) } }, data: { status: "CANCELADA" } });
    await db.assinatura.update({ where: { id: a.id }, data: { formaPagamento: "CARTAO", gatewayId: null } });
    a = await assinaturaPorToken(tokenPublico);
  }
  if (a.gatewayId) return trocarCartao(tokenPublico, cartaoToken); // ja existe: so troca o cartao
  if (a.formaPagamento !== "CARTAO" || !a.gatewayClienteId) throw new ErroNegocio("Essa assinatura não é no cartão.");
  const g = await gateway();
  const cfg = await configuracao();
  let gatewayId: string;
  try {
    gatewayId = await g.criarAssinatura({
      clienteGatewayId: a.gatewayClienteId,
      valorCentavos: a.precoCentavos,
      forma: "CARTAO",
      primeiroVencimento: new Date().toISOString().slice(0, 10),
      descricao: `${a.plano.nome} - ${cfg.nomeBarbearia}`,
      referencia: a.id,
      cartaoToken,
    });
  } catch (e) {
    throw erroDeCartao(e);
  }
  await db.assinatura.update({ where: { id: a.id }, data: { gatewayId } });
  await sincronizarAssinatura(a.id);
  return db.assinatura.findUniqueOrThrow({ where: { id: a.id }, select: { status: true } });
}

/** Cartao recusado ou vencido: troca o cartao e reprocessa. */
export async function trocarCartao(tokenPublico: string, cartaoToken: string) {
  const a = await assinaturaPorToken(tokenPublico);
  if (!a.gatewayId || a.formaPagamento !== "CARTAO") throw new ErroNegocio("Essa assinatura não é no cartão.");
  const g = await gatewayPorId(a.gatewayId);
  if (!g.atualizarCartao) throw new ErroNegocio("Troca de cartão indisponível neste meio de pagamento.");
  try {
    await g.atualizarCartao(a.gatewayId, cartaoToken);
  } catch (e) {
    throw erroDeCartao(e);
  }
  await sincronizarAssinatura(a.id);
  return db.assinatura.findUniqueOrThrow({ where: { id: a.id }, select: { status: true } });
}

/**
 * Aba Pix do checkout do plano: a assinatura (ainda sem pagamento) passa a ser Pix e o
 * BarberOS gera o Pix do 1o mes. Ja era Pix: devolve o Pix em aberto (renova se venceu).
 */
export async function pagarPlanoComPix(tokenPublico: string) {
  const a = await assinaturaPorToken(tokenPublico);
  if (a.status === "CANCELADA") throw new ErroNegocio("Essa assinatura foi cancelada.");
  if (a.status !== "PENDENTE") throw new ErroNegocio("Essa assinatura já está paga. ✅", 409, "ja_pago");
  if (!a.plano.formasPagamento.includes("PIX")) throw new ErroNegocio("Esse plano não aceita Pix.");
  if (pixPendente(a)) {
    const aberta = await cobrancaEmAberto(a.id);
    if (aberta) return renovarPixSeExpirado(aberta.id);
  } else if (a.formaPagamento !== "CARTAO" || a.gatewayId) {
    throw new ErroNegocio("Essa assinatura já tem uma forma de pagamento. Fale com a barbearia.", 409, "forma");
  }
  const g = await gateway();
  if (g.pix !== "avulso" || !a.gatewayClienteId) throw new ErroNegocio("Pix indisponível para esse plano agora.", 409, "indisponivel");
  const cfg = await configuracao();
  try {
    const gatewayId = a.gatewayId ?? (await g.criarAssinatura({
      clienteGatewayId: a.gatewayClienteId, valorCentavos: a.precoCentavos, forma: "PIX",
      primeiroVencimento: dataLocal(Date.now(), cfg.fuso), descricao: `${a.plano.nome} - ${cfg.nomeBarbearia}`, referencia: a.id,
    }));
    await db.assinatura.update({ where: { id: a.id }, data: { formaPagamento: "PIX", gatewayId } });
    return await gerarPixDoMes(a.id, dataLocal(Date.now(), cfg.fuso));
  } catch (e) {
    // Nao gerou o Pix: a assinatura volta a ser como era (o cliente pode tentar o cartao).
    await db.assinatura.update({ where: { id: a.id }, data: { formaPagamento: a.formaPagamento, gatewayId: a.gatewayId } }).catch(() => {});
    console.error("[assinaturas] Pix do checkout:", e);
    throw new ErroNegocio("Não foi possível gerar o Pix agora. Tente de novo em instantes.", 502, "gateway");
  }
}

/** Estado do checkout do plano (status da assinatura e o Pix do 1o mes). `conferir`: consulta o gateway. */
export async function checkoutDaAssinatura(tokenPublico: string, conferir = true): Promise<EstadoCheckout> {
  const a = await assinaturaPorToken(tokenPublico);
  if (a.status === "CANCELADA") return { status: "CANCELADO", forma: null, pix: null, link: null };
  if (a.status !== "PENDENTE") return { status: "PAGO", forma: a.formaPagamento === "PIX" ? "PIX" : "CARTAO", pix: null, link: null };
  if (!pixPendente(a)) {
    // Cartao ja enviado e o 1o mes sem resposta ainda (nem pago nem recusado): em analise.
    if (conferir && a.gatewayId && a.formaPagamento === "CARTAO") {
      await sincronizarAssinatura(a.id).catch((e) => console.error("[assinaturas] conferir cartão", a.id, e));
      if ((await db.assinatura.findUniqueOrThrow({ where: { id: a.id } })).status !== "PENDENTE") return { status: "PAGO", forma: "CARTAO", pix: null, link: null };
    }
    const ultima = a.gatewayId ? await db.cobranca.findFirst({ where: { assinaturaId: a.id }, orderBy: { criadaEm: "desc" } }) : null;
    const processando = a.formaPagamento === "CARTAO" && !!a.gatewayId && ultima?.status !== "ATRASADA";
    return { status: "PENDENTE", forma: processando ? "CARTAO" : null, pix: null, link: null, processando };
  }
  const abertas = conferir
    ? await conferirPixEmAberto(a.id)
    : await db.cobranca.findMany({ where: { assinaturaId: a.id, status: { in: ["PENDENTE", "ATRASADA"] } } });
  if (conferir && (await db.assinatura.findUniqueOrThrow({ where: { id: a.id } })).status !== "PENDENTE") return { status: "PAGO", forma: "PIX", pix: null, link: null };
  const c: Cobranca | undefined = abertas.find((x) => x.forma === "PIX" && x.pixCopiaECola && !pixVencido(x.expiraEm));
  return {
    status: "PENDENTE", forma: "PIX", link: null,
    pix: c ? { copiaECola: c.pixCopiaECola!, qrUrl: c.pixQrUrl, expiraEm: c.expiraEm?.toISOString() ?? null } : null,
  };
}
