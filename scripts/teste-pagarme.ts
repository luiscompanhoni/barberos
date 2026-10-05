// Teste de integracao do fluxo Pagar.me contra o banco de DESENVOLVIMENTO, com uma
// Pagar.me FALSA em memoria (nenhuma chamada real). Cria e apaga os proprios dados.
// Rodar: npm run teste:pagarme
process.env.PAGAMENTOS_PROVIDER = "pagarme";
process.env.PAGARME_SECRET_KEY = "sk_test_falsa";

import { db } from "@/lib/db";
import { _usarFetch } from "@/lib/pagamentos/pagarme";
import { assinar, situacaoDoCliente } from "@/lib/assinaturas/servico";
import { processarEventoGateway, cobrancaEmAberto } from "@/lib/assinaturas/cobrancas";
import { ativarComCartao } from "@/lib/assinaturas/cartao-pix";
import { gerarPixDoProximoMes, marcarVencidas } from "@/lib/assinaturas/rotina";
import { ErroNegocio } from "@/lib/erros";

const ok = (c: boolean, msg: string) => console.log(`${c ? "OK  " : "FALHOU"} ${msg}`);

// ---- Pagar.me falsa
type Charge = { id: string; amount: number; status: string; payment_method: string; created_at: string; due_at?: string; invoice?: { id: string; subscriptionId: string }; last_transaction: Record<string, string> };
const charges = new Map<string, Charge>();
const invoices: { id: string; sub: string; charge: string }[] = [];
let seq = 0;
const nid = (p: string) => `${p}_${++seq}`;
_usarFetch((async (url: string, init?: RequestInit) => {
  const u = new URL(url);
  const caminho = u.pathname.replace("/core/v5", "");
  const corpo = init?.body ? JSON.parse(String(init.body)) : {};
  const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status });
  if (init?.method === "POST" && caminho === "/customers") return json({ id: nid("cus") });
  if (init?.method === "POST" && caminho === "/orders") {
    const ch: Charge = { id: nid("ch"), amount: corpo.items[0].amount, status: "pending", payment_method: "pix", created_at: new Date().toISOString(),
      last_transaction: { qr_code: "00020126PIXFALSO", qr_code_url: "https://exemplo/qr.png", expires_at: new Date(Date.now() + 86400000).toISOString() } };
    charges.set(ch.id, ch);
    return json({ id: nid("or"), charges: [ch] });
  }
  if (init?.method === "POST" && caminho === "/subscriptions") {
    if (corpo.card_token === "token_recusado") return json({ message: "Card declined" }, 422);
    const sub = nid("sub");
    const ch: Charge = { id: nid("ch"), amount: corpo.items[0].pricing_scheme.price, status: "paid", payment_method: "credit_card",
      created_at: new Date().toISOString(), due_at: new Date().toISOString(), invoice: { id: nid("in"), subscriptionId: sub }, last_transaction: {} };
    charges.set(ch.id, ch);
    invoices.push({ id: ch.invoice!.id, sub, charge: ch.id });
    return json({ id: sub });
  }
  if (caminho === "/invoices") return json({ data: invoices.filter((i) => i.sub === u.searchParams.get("subscription_id")).map((i) => ({ id: i.id, charge: { id: i.charge } })) });
  const m = caminho.match(/^\/charges\/(.+)$/);
  if (m && charges.has(m[1])) return json(charges.get(m[1]));
  return json({ message: `rota falsa nao implementada: ${init?.method} ${caminho}` }, 404);
}) as typeof fetch);

async function limpar(tel: string) {
  const c = await db.cliente.findUnique({ where: { telefone: tel } });
  if (!c) return;
  await db.agendamento.deleteMany({ where: { clienteId: c.id } });
  await db.assinatura.deleteMany({ where: { clienteId: c.id } });
  await db.conversa.deleteMany({ where: { telefone: tel } });
  await db.cliente.delete({ where: { id: c.id } });
}

async function main() {
  const P = "5511933339001", C = "5511933339002";
  await limpar(P); await limpar(C);
  const cp = await db.cliente.create({ data: { telefone: P, nome: "Pix Teste" } });
  const cc = await db.cliente.create({ data: { telefone: C, nome: "Cartao Teste" } });
  const plano = await db.plano.findFirstOrThrow({ where: { nome: "Plano Corte" } });

  // E-mail e obrigatorio na Pagar.me
  let e: unknown = null;
  try { await assinar({ clienteId: cp.id, planoId: plano.id, forma: "PIX", cpf: "52998224725", origem: "SITE" }); } catch (x) { e = x; }
  ok(e instanceof ErroNegocio && e.codigo === "email", "sem e-mail: recusado");

  // ---- PIX
  const rp = await assinar({ clienteId: cp.id, planoId: plano.id, forma: "PIX", cpf: "52998224725", email: "pix@teste.com", origem: "SITE" });
  const cob = await cobrancaEmAberto(rp.assinatura.id);
  ok(!!rp.link?.includes("/c/pagar/") && !!cob?.tokenPublico && rp.link.endsWith(cob.tokenPublico), `Pix: link da página de pagamento (${rp.link})`);
  ok(cob?.pixCopiaECola === "00020126PIXFALSO" && cob?.forma === "PIX", "Pix: QR e copia e cola salvos");
  // cliente paga -> webhook
  charges.get(cob!.gatewayId)!.status = "paid";
  // Id de evento unico por execucao: o webhook ignora evento repetido (idempotencia).
  await processarEventoGateway(`hook_${Date.now()}:${cob!.gatewayId}`, "charge.paid", cob!.gatewayId);
  let sit = await situacaoDoCliente(cp.id);
  ok(sit?.assinatura.status === "ATIVA", "Pix pago: ATIVA");
  const venc1 = sit!.assinatura.proximoVencimento!.toISOString().slice(0, 10);
  ok(!!venc1, `próximo vencimento: ${venc1}`);
  // rotina gera o Pix do proximo mes quando faltam 3 dias
  await db.assinatura.update({ where: { id: sit!.assinatura.id }, data: { proximoVencimento: new Date(Date.now() + 2 * 86400000) } });
  const geradas = await gerarPixDoProximoMes();
  const geradas2 = await gerarPixDoProximoMes();
  ok(geradas >= 1 && geradas2 === 0, "rotina gera o Pix do próximo mês uma vez só");
  // O aviso sai em segundo plano: espera ate 3 s.
  let aviso = null;
  for (let i = 0; i < 30 && !aviso; i++) {
    aviso = await db.mensagem.findFirst({ where: { conversa: { telefone: P }, texto: { contains: "Pix para pagar" } } });
    if (!aviso) await new Promise((r) => setTimeout(r, 100));
  }
  ok(!!aviso, "cliente recebe o Pix no WhatsApp");
  // vence sem pagar
  const prox = await cobrancaEmAberto(sit!.assinatura.id);
  await db.cobranca.update({ where: { id: prox!.id }, data: { vencimento: new Date(Date.now() - 2 * 86400000) } });
  await marcarVencidas();
  sit = await situacaoDoCliente(cp.id);
  ok(sit?.assinatura.status === "ATRASADA" && sit.valida, "vencido sem pagar: ATRASADA (ainda na tolerância)");

  // ---- CARTAO
  const rc = await assinar({ clienteId: cc.id, planoId: plano.id, forma: "CARTAO", cpf: "52998224725", email: "cartao@teste.com", origem: "SITE" });
  const tokenAss = rc.assinatura.tokenPublico!;
  ok(!!rc.link?.includes(`/c/assinar/${tokenAss}`), "cartão: link para digitar o cartão");
  e = null;
  try { await ativarComCartao(tokenAss, "token_recusado"); } catch (x) { e = x; }
  ok(e instanceof ErroNegocio && e.codigo === "cartao_recusado", "cartão recusado: mensagem amigável");
  const r = await ativarComCartao(tokenAss, "token_bom");
  ok(r.status === "ATIVA", "cartão aprovado: ATIVA na hora");

  await limpar(P); await limpar(C);
  await db.$disconnect();
}
main().catch((x) => { console.error(x); process.exit(1); });
