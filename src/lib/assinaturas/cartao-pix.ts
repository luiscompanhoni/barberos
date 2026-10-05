/**
 * Fluxos de gateways que nao tem fatura hospedada (Pagar.me):
 * - cartao digitado na pagina do BarberOS e tokenizado no navegador;
 * - Pix gerado pelo BarberOS a cada mes.
 */
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { configuracao } from "@/lib/agenda/carregar";
import { gateway } from "@/lib/pagamentos/gateway";
import { sincronizarAssinatura, sincronizarCobranca } from "./cobrancas";

/** Gera (e salva) a cobranca Pix de um mes da assinatura. */
export async function gerarPixDoMes(assinaturaId: string, vencimento: string) {
  const g = await gateway();
  if (!g.criarCobrancaPix) throw new Error(`O gateway ${g.nome} não gera Pix avulso.`);
  const a = await db.assinatura.findUniqueOrThrow({ where: { id: assinaturaId }, include: { plano: true } });
  if (!a.gatewayId || !a.gatewayClienteId) throw new Error("Assinatura sem cadastro no meio de pagamento.");
  const cfg = await configuracao();
  const cob = await g.criarCobrancaPix({
    clienteGatewayId: a.gatewayClienteId,
    valorCentavos: a.precoCentavos,
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

/**
 * Primeiro pagamento no cartao: cria a assinatura na Pagar.me com o token
 * gerado no navegador. A primeira cobranca acontece na hora.
 */
export async function ativarComCartao(tokenPublico: string, cartaoToken: string) {
  const a = await assinaturaPorToken(tokenPublico);
  if (a.status === "CANCELADA") throw new ErroNegocio("Essa assinatura foi cancelada.");
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
  const g = await gateway();
  if (!g.atualizarCartao) throw new ErroNegocio("Troca de cartão indisponível neste meio de pagamento.");
  try {
    await g.atualizarCartao(a.gatewayId, cartaoToken);
  } catch (e) {
    throw erroDeCartao(e);
  }
  await sincronizarAssinatura(a.id);
  return db.assinatura.findUniqueOrThrow({ where: { id: a.id }, select: { status: true } });
}
