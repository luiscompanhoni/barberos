// Teste de integracao do checkout online (Pagar.me) contra o banco de DESENVOLVIMENTO, com uma
// Pagar.me FALSA e uma Celcash FALSA em memoria (nenhuma chamada real sai daqui: qualquer outro
// endereco derruba o teste). Cria e apaga os proprios dados. Rodar: npm run teste:checkout
process.env.PAGAMENTOS_PROVIDER = "pagarme";
process.env.PAGARME_SECRET_KEY = "sk_test_falsa";
process.env.CELCASH_GALAX_ID = "falso";
process.env.CELCASH_GALAX_HASH = "falso";
delete process.env.CELCASH_AMBIENTE;
process.env.WHATSAPP_PROVIDER = "simulador";

process.env.COBRANCA_ENDERECO ||= "50, Rua Teste, Centro"; process.env.COBRANCA_CEP ||= "89160161"; process.env.COBRANCA_CIDADE ||= "Rio do Sul"; process.env.COBRANCA_UF ||= "SC";
import type { Sessao } from "@/lib/auth/sessao";
import { checkoutDoHorario, pagarAntecipado, sincronizarAntecipado } from "@/lib/agenda/antecipado";
import { ativarComCartao, checkoutDaAssinatura, pagarPlanoComPix } from "@/lib/assinaturas/cartao-pix";
import { processarEventoGateway, sincronizarAssinatura } from "@/lib/assinaturas/cobrancas";
import { rodarRotinaDePagamentos } from "@/lib/assinaturas/rotina";
import { assinar, cancelar } from "@/lib/assinaturas/servico";
import { cancelarPagamento } from "@/lib/comandas/maquininha";
import { abrirComanda, adicionarAvulso, detalheComanda, fecharComanda } from "@/lib/comandas/servico";
import { db } from "@/lib/db";
import { horarioLivre } from "./util-teste";
import { conciliacao } from "@/lib/financeiro/conciliacao";
import { resumoMes } from "@/lib/financeiro/resumo";
import { cancelarLink, criarLink, linkPublico, pagarLink, sincronizarLinksPendentes } from "@/lib/links/servico";
import { dataLocal } from "@/lib/agenda/tempo";
import { _usarFetch } from "@/lib/pagamentos/pagarme";
import { alvosDoWebhook, processarWebhookPagarme } from "@/lib/pagamentos/webhook-pagarme";

const ok = (c: boolean, msg: string) => { console.log(`${c ? "OK  " : "FALHOU"} ${msg}`); if (!c) process.exitCode = 1; };
const falha = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e) { return e as Error & { codigo?: string }; } };
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ Pagar.me falsa
type Charge = { id: string; amount: number; status: string; payment_method: string; created_at: string; paid_at?: string; due_at?: string;
  invoice?: { id: string; subscriptionId: string }; last_transaction: Record<string, string> };
type Order = { id: string; status: string; charges: Charge[]; pedido: Record<string, unknown> };
const orders = new Map<string, Order>();
const charges = new Map<string, Charge>();
const invoices: { id: string; sub: string; charge: string }[] = [];
const chamadas: { host: string; metodo: string; caminho: string }[] = [];
let seq = 0;
const nid = (p: string) => `${p}_${Date.now().toString(36)}${++seq}`;
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status });

function pagarme(metodo: string, caminho: string, corpo: Record<string, any>, u: URL) { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (metodo === "POST" && caminho === "/customers") return json({ id: nid("cus") });
  if (metodo === "POST" && caminho === "/orders") {
    const pg = corpo.payments[0];
    const agora = new Date().toISOString();
    const ch: Charge = { id: nid("ch"), amount: corpo.items[0].amount, status: "pending", payment_method: pg.payment_method, created_at: agora, last_transaction: {} };
    let status = "pending";
    if (pg.payment_method === "pix") {
      ch.last_transaction = { qr_code: `00020126PIXFALSO${ch.id}`, qr_code_url: "https://exemplo/qr.png", expires_at: new Date(Date.now() + pg.pix.expires_in * 1000).toISOString() };
    } else if (!pg.credit_card.card?.billing_address?.zip_code) {
      // Como a Pagar.me real: cartao sem endereco de cobranca falha na validacao.
      ch.status = "failed"; status = "failed";
      ch.last_transaction = { status: "failed", acquirer_message: "validation_error | billing | value is required" };
    } else if (pg.credit_card.card_token === "token_recusado") {
      ch.status = "failed"; status = "failed";
      ch.last_transaction = { status: "not_authorized", acquirer_message: "Saldo insuficiente" };
    } else if (pg.credit_card.card_token === "token_analise") {
      ch.status = "processing";
    } else {
      ch.status = "paid"; ch.paid_at = agora; status = "paid";
    }
    const o: Order = { id: nid("or"), status, charges: [ch], pedido: corpo };
    orders.set(o.id, o);
    charges.set(ch.id, ch);
    return json({ id: o.id, status: o.status, charges: o.charges });
  }
  let m = caminho.match(/^\/orders\/(.+)$/);
  if (metodo === "GET" && m && orders.has(m[1])) { const o = orders.get(m[1])!; return json({ id: o.id, status: o.status, charges: o.charges }); }
  m = caminho.match(/^\/charges\/(.+)$/);
  if (m && charges.has(m[1])) {
    const ch = charges.get(m[1])!;
    if (metodo === "DELETE") ch.status = "canceled";
    for (const o of orders.values()) if (o.charges.includes(ch) && o.charges.every((c) => c.status === "canceled")) o.status = "canceled";
    return json(ch);
  }
  if (metodo === "POST" && caminho === "/subscriptions") {
    if (corpo.payment_method === "credit_card" && !corpo.card?.billing_address?.zip_code) return json({ message: "billing value is required" }, 422);
    if (corpo.card_token === "token_recusado") return json({ message: "Card declined" }, 422);
    const sub = nid("sub");
    const ch: Charge = { id: nid("ch"), amount: corpo.items[0].pricing_scheme.price, status: "paid", payment_method: "credit_card",
      created_at: new Date().toISOString(), due_at: new Date().toISOString(), paid_at: new Date().toISOString(), invoice: { id: nid("in"), subscriptionId: sub }, last_transaction: {} };
    charges.set(ch.id, ch);
    invoices.push({ id: ch.invoice!.id, sub, charge: ch.id });
    return json({ id: sub });
  }
  if (caminho === "/invoices") return json({ data: invoices.filter((i) => i.sub === u.searchParams.get("subscription_id")).map((i) => ({ id: i.id, charge: { id: i.charge } })) });
  return json({ message: `rota falsa nao implementada: ${metodo} ${caminho}` }, 404);
}

/** O cliente paga o Pix no banco. */
function pagarPedido(id: string) {
  const o = orders.get(id)!;
  o.status = "paid";
  for (const c of o.charges) { c.status = "paid"; c.paid_at = new Date().toISOString(); }
}

// ------------------------------------------------------------------ Celcash falsa
const HOJE = new Date().toISOString().slice(0, 10);
function celcash(metodo: string, caminho: string, u: URL) {
  if (caminho === "/token") return json({ access_token: "tok_falso", expires_in: 600 });
  const ids = u.searchParams.get("galaxPayIds");
  if (metodo === "GET" && caminho === "/subscriptions") {
    return json({ Subscriptions: [{ galaxPayId: Number(ids), mainPaymentMethodId: "pix", paymentLink: null,
      Transactions: [{ galaxPayId: 9001, subscriptionGalaxPayId: Number(ids), value: 7000, payday: HOJE, paydayDate: HOJE, status: "payedPix" }] }] });
  }
  if (metodo === "GET" && caminho === "/transactions") {
    return json({ Transactions: [{ galaxPayId: Number(ids), subscriptionGalaxPayId: null, value: 7000, payday: HOJE, paydayDate: HOJE, status: "payedPix", Pix: { qrCode: "pix-cel" } }] });
  }
  if (metodo === "GET" && caminho === "/charges") {
    return json({ Charges: [{ galaxPayId: Number(ids), mainPaymentMethodId: "pix", Transactions: [{ galaxPayId: 7001, value: 4321, payday: HOJE, paydayDate: HOJE, status: "payedPix" }] }] });
  }
  if (metodo === "DELETE") return json({ type: true });
  return json({ error: { message: `rota falsa nao implementada: ${metodo} ${caminho}` } }, 404);
}

const falsa = (async (url: string | URL, init?: RequestInit) => {
  const u = new URL(String(url));
  const metodo = init?.method ?? "GET";
  const corpo = init?.body ? JSON.parse(String(init.body)) : {};
  if (u.host === "api.pagar.me") {
    const caminho = u.pathname.replace("/core/v5", "");
    chamadas.push({ host: "pagarme", metodo, caminho });
    return pagarme(metodo, caminho, corpo, u);
  }
  if (u.host === "api.sandbox.cel.cash") {
    const caminho = u.pathname.replace("/v2", "");
    chamadas.push({ host: "celcash", metodo, caminho });
    return celcash(metodo, caminho, u);
  }
  throw new Error(`Chamada externa proibida no teste: ${u.href}`);
}) as typeof fetch;
globalThis.fetch = falsa;
_usarFetch(falsa);
const contar = (host: string, depois = 0) => chamadas.slice(depois).filter((c) => c.host === host).length;

// ------------------------------------------------------------------ dados
const TEL = ["5511933338001", "5511933338002", "5511933338003", "5511933338004"];
async function limpar() {
  await db.linkPagamento.updateMany({ where: { telefone: { in: TEL } }, data: { comandaId: null } });
  for (const tel of TEL) {
    const c = await db.cliente.findUnique({ where: { telefone: tel } });
    if (c) {
      const cs = await db.comanda.findMany({ where: { clienteId: c.id }, select: { id: true } });
      await db.pagamentoComanda.deleteMany({ where: { comandaId: { in: cs.map((x) => x.id) } } });
      await db.itemComanda.deleteMany({ where: { comandaId: { in: cs.map((x) => x.id) } } });
      await db.comanda.deleteMany({ where: { id: { in: cs.map((x) => x.id) } } });
      await db.pagamentoAntecipado.deleteMany({ where: { clienteId: c.id } });
      await db.beneficio.deleteMany({ where: { clienteId: c.id } });
      await db.agendamento.deleteMany({ where: { clienteId: c.id } });
      await db.assinatura.deleteMany({ where: { clienteId: c.id } });
    }
    await db.pagamentoComanda.deleteMany({ where: { linkPagamento: { telefone: tel } } });
    await db.linkPagamento.deleteMany({ where: { telefone: tel } });
    const conv = await db.conversa.findUnique({ where: { telefone: tel } });
    if (conv) { await db.mensagem.deleteMany({ where: { conversaId: conv.id } }); await db.conversa.delete({ where: { id: conv.id } }); }
    if (c) await db.cliente.delete({ where: { id: c.id } });
  }
  await db.comanda.deleteMany({ where: { nomeAvulso: "Teste Checkout Avulso" } });
  await db.eventoPagamento.deleteMany({ where: { id: { startsWith: "tchk_" } } });
}
async function mensagem(tel: string, trecho: string) {
  for (let i = 0; i < 30; i++) {
    const m = await db.mensagem.findFirst({ where: { conversa: { telefone: tel }, texto: { contains: trecho } } });
    if (m) return m;
    await esperar(100);
  }
  return null;
}

async function main() {
  await limpar();
  const dono = await db.usuario.findFirstOrThrow({ where: { papel: "DONO" } });
  const s: Sessao = { usuarioId: dono.id, papel: "DONO", nome: dono.nome, barbeiroId: null, clienteId: null };
  const barbeiro = await db.barbeiro.findFirstOrThrow({ where: { ativo: true } });
  const servico = await db.servico.findFirstOrThrow({ where: { ativo: true } });
  const cliente = await db.cliente.create({ data: { telefone: TEL[0], nome: "Teste Checkout", cpf: "40563771038", email: "checkout@example.com" } });
  let minuto = 0;
  const marcar = async () => {
    const inicio = await horarioLivre(barbeiro.id, new Date(Date.now() + 3 * 86_400_000 + (minuto += 120) * 60_000));
    return db.agendamento.create({
      data: { barbeiroId: barbeiro.id, clienteId: cliente.id, servicoId: servico.id, inicio, fim: new Date(inicio.getTime() + 30 * 60_000), precoCentavos: 4321, origem: "SITE", status: "MARCADO" },
    });
  };
  const evento = (tipo: string, pedido: Order) => alvosDoWebhook({ id: `tchk_${nid("hook")}`, type: tipo, data: { id: pedido.id, charges: pedido.charges.map((c) => ({ id: c.id })) } })!;

  // ---- 1) horario pago antes: Pix
  const ag1 = await marcar();
  const p1 = await pagarAntecipado({ clienteId: cliente.id, agendamentoId: ag1.id, forma: "PIX" });
  const o1 = orders.get(p1.id ? (await db.pagamentoAntecipado.findUniqueOrThrow({ where: { id: p1.id } })).gatewayId! : "")!;
  ok(p1.status === "PENDENTE" && !!p1.pixCopiaECola && !!p1.pixExpiraEm && !!p1.link?.includes(`/c/pagar-horario/${ag1.id}`), "antecipado Pix: QR, copia e cola, validade e link do checkout");
  const exp = (o1.pedido.payments as { pix: { expires_in: number } }[])[0].pix.expires_in;
  ok(exp <= 86_400 && exp >= 300 && o1.id.startsWith("or_"), `Pix vale até 1 dia (expires_in ${exp}s) e o id é do pedido (${o1.id.slice(0, 3)}…)`);
  const p1b = await pagarAntecipado({ clienteId: cliente.id, agendamentoId: ag1.id, forma: "PIX" });
  ok(p1b.pixCopiaECola === p1.pixCopiaECola, "pedir de novo reaproveita o mesmo Pix");
  pagarPedido(o1.id);
  await processarWebhookPagarme(evento("order.paid", o1));
  ok((await db.pagamentoAntecipado.findUniqueOrThrow({ where: { agendamentoId: ag1.id } })).status === "PAGO", "webhook order.paid confirma o horário na hora");
  ok((await checkoutDoHorario(cliente.id, ag1.id, false)).status === "PAGO", "checkout do horário mostra pago");
  ok(!!(await mensagem(TEL[0], "Recebemos o pagamento de R$")), "cliente avisado no WhatsApp");

  // ---- 2) horario: cartao sem token devolve o checkout; recusado; aprovado
  const ag2 = await marcar();
  const antes = chamadas.length;
  const sem = await pagarAntecipado({ clienteId: cliente.id, agendamentoId: ag2.id, forma: "CARTAO" });
  ok(!!sem.link?.includes(`/c/pagar-horario/${ag2.id}`) && contar("pagarme", antes) === 0, "cartão sem token: devolve a página do checkout (bot), sem chamar a Pagar.me");
  const e2 = await falha(() => pagarAntecipado({ clienteId: cliente.id, agendamentoId: ag2.id, forma: "CARTAO", cartaoToken: "token_recusado" }));
  ok(e2?.codigo === "cartao_recusado" && !!e2.message.includes("Saldo insuficiente"), `cartão recusado: mensagem do banco (${e2?.message})`);
  ok((await db.pagamentoAntecipado.findUniqueOrThrow({ where: { agendamentoId: ag2.id } })).status === "CANCELADO", "recusa não deixa pagamento pendente");
  ok((await checkoutDoHorario(cliente.id, ag2.id, false)).status === "PENDENTE", "depois da recusa dá para tentar outro cartão");
  const p2 = await pagarAntecipado({ clienteId: cliente.id, agendamentoId: ag2.id, forma: "CARTAO", cartaoToken: "token_bom" });
  const o2 = orders.get((await db.pagamentoAntecipado.findUniqueOrThrow({ where: { agendamentoId: ag2.id } })).gatewayId!)!;
  const cc = (o2.pedido.payments as { credit_card: { operation_type: string; installments: number } }[])[0].credit_card;
  ok(p2.status === "PAGO" && cc.operation_type === "auth_and_capture" && cc.installments === 1, "cartão aprovado: cobrado na hora (auth_and_capture), já PAGO");
  const { id: com2 } = await abrirComanda(s, { agendamentoId: ag2.id });
  const d2 = await detalheComanda(com2);
  ok(d2.pagamentos.some((p) => p.antecipadoId && p.forma === "CREDITO" && p.status === "PAGO") && d2.resumo.falta === 0, "comanda do atendimento já nasce paga (crédito online)");

  // ---- 3) cartao em analise: confirma depois pelo webhook (charge.paid)
  const ag3 = await marcar();
  const p3 = await pagarAntecipado({ clienteId: cliente.id, agendamentoId: ag3.id, forma: "CARTAO", cartaoToken: "token_analise" });
  const o3 = orders.get((await db.pagamentoAntecipado.findUniqueOrThrow({ where: { agendamentoId: ag3.id } })).gatewayId!)!;
  ok(p3.status === "PENDENTE" && !!(await checkoutDoHorario(cliente.id, ag3.id, false)).processando, "cartão em análise fica pendente (checkout mostra processando)");
  pagarPedido(o3.id);
  await processarWebhookPagarme(alvosDoWebhook({ id: `tchk_${nid("hook")}`, type: "charge.paid", data: { id: o3.charges[0].id, order: { id: o3.id } } })!);
  ok((await db.pagamentoAntecipado.findUniqueOrThrow({ where: { agendamentoId: ag3.id } })).status === "PAGO", "webhook charge.paid (com o pedido) confirma o cartão");

  // ---- 4) link avulso pago no Pix (sem cadastro: pede CPF e e-mail)
  const { link: l4 } = await criarLink(s, { nome: "Fulano Sem Cadastro", telefone: "(11) 93333-8002", descricao: "Pomada modeladora", valorCentavos: 4500, validadeDias: 3, parcelasMax: 1 });
  ok(l4.status === "PENDENTE" && l4.url.includes(`/c/link/${l4.token}`) && l4.telefone === TEL[1], "link criado com o endereço público e o celular normalizado");
  const pub4 = await linkPublico(l4.token);
  ok(pub4.link.pedir.cpf && pub4.link.pedir.email && pub4.checkout.status === "PENDENTE", "página pede CPF e e-mail de quem não tem cadastro");
  ok((await falha(() => pagarLink(l4.token, { forma: "PIX" })))?.codigo === "cpf", "sem CPF: recusa com o pedido do dado");
  const c4 = await pagarLink(l4.token, { forma: "PIX", cpf: "529.982.247-25", email: "fulano@example.com" });
  ok(c4.status === "PENDENTE" && !!c4.pix?.copiaECola && !!c4.pix.expiraEm, "link: Pix gerado com QR e validade");
  const c4b = await pagarLink(l4.token, { forma: "PIX" });
  ok(c4b.pix?.copiaECola === c4.pix?.copiaECola, "recarregar a página reaproveita o mesmo Pix");
  const o4 = orders.get((await db.linkPagamento.findUniqueOrThrow({ where: { id: l4.id } })).gatewayId!)!;
  pagarPedido(o4.id);
  await processarWebhookPagarme(evento("order.paid", o4));
  const l4p = await db.linkPagamento.findUniqueOrThrow({ where: { id: l4.id } });
  ok(l4p.status === "PAGO" && !!l4p.pagoEm && l4p.forma === "PIX", "webhook confirma o link: PAGO");
  ok(!!(await mensagem(TEL[1], "Recebemos o pagamento de R$")), "quem pagou recebe o aviso no WhatsApp");
  ok((await falha(() => pagarLink(l4.token, { forma: "PIX" })))?.codigo === "ja_pago", "link pago não cobra de novo");

  // ---- 5) link pagando uma comanda aberta no cartao (parcelado)
  const { id: com5 } = await abrirComanda(s, { clienteId: cliente.id });
  await adicionarAvulso(s, com5, "Corte + barba (teste)", 9000, 1);
  ok((await falha(() => criarLink(s, { comandaId: com5, descricao: "Comanda", valorCentavos: 9001, validadeDias: 1, parcelasMax: 3 }))) !== null, "valor maior que a comanda: recusado");
  const { link: l5 } = await criarLink(s, { comandaId: com5, descricao: "Comanda", valorCentavos: 9000, validadeDias: 1, parcelasMax: 3 });
  ok(l5.clienteId === cliente.id && l5.comandaId === com5, "link da comanda já vem com o cliente dela");
  ok((await falha(() => criarLink(s, { comandaId: com5, descricao: "De novo", valorCentavos: 100, validadeDias: 1, parcelasMax: 1 }))) !== null, "não cria outro link além do que falta (link em aberto conta)");
  ok((await detalheComanda(com5)).linksPagamento.length === 1, "comanda mostra o link em aberto");
  ok((await falha(() => pagarLink(l5.token, { forma: "CARTAO", cartaoToken: "token_bom", parcelas: 4 })))?.codigo === "parcelas", "mais parcelas que o permitido: recusado");
  const r5 = await falha(() => pagarLink(l5.token, { forma: "CARTAO", cartaoToken: "token_recusado", parcelas: 2 }));
  ok(r5?.codigo === "cartao_recusado" && (await db.linkPagamento.findUniqueOrThrow({ where: { id: l5.id } })).status === "PENDENTE", "cartão recusado no link: continua aberto para tentar outro");
  const c5 = await pagarLink(l5.token, { forma: "CARTAO", cartaoToken: "token_bom", parcelas: 3 });
  const o5 = orders.get((await db.linkPagamento.findUniqueOrThrow({ where: { id: l5.id } })).gatewayId!)!;
  ok(c5.status === "PAGO" && (o5.pedido.payments as { credit_card: { installments: number } }[])[0].credit_card.installments === 3, "cartão aprovado em 3x: link PAGO na hora");
  const d5 = await detalheComanda(com5);
  const pg5 = d5.pagamentos.find((p) => p.linkPagamentoId === l5.id);
  ok(!!pg5 && pg5.status === "PAGO" && pg5.forma === "CREDITO" && pg5.valorCentavos === 9000 && d5.resumo.falta === 0, "comanda recebe o pagamento CREDITO ligado ao link");
  ok((await falha(() => cancelarPagamento(s, pg5!.id)))?.codigo === "link", "pagamento do link não pode ser desfeito na comanda");
  await fecharComanda(s, com5);
  ok((await db.comanda.findUniqueOrThrow({ where: { id: com5 } })).status === "FECHADA", "comanda fecha sem receber no balcão");

  // ---- 6) link Pix pagando comanda (Pix na comanda) e conciliacao/resumo sem contar em dobro
  const { id: com6 } = await abrirComanda(s, { nomeAvulso: "Teste Checkout Avulso" });
  await adicionarAvulso(s, com6, "Cerveja (teste)", 1500, 1);
  const { link: l6 } = await criarLink(s, { comandaId: com6, nome: "Avulso", telefone: TEL[2], descricao: "Bar", valorCentavos: 1500, validadeDias: 1, parcelasMax: 1 });
  await pagarLink(l6.token, { forma: "PIX", cpf: "52998224725", email: "avulso@example.com" });
  const o6 = orders.get((await db.linkPagamento.findUniqueOrThrow({ where: { id: l6.id } })).gatewayId!)!;
  pagarPedido(o6.id);
  await processarWebhookPagarme(evento("order.paid", o6));
  await processarWebhookPagarme(evento("order.paid", o6)); // repetido: nada muda
  const d6 = await detalheComanda(com6);
  ok(d6.pagamentos.filter((p) => p.linkPagamentoId === l6.id && p.forma === "PIX").length === 1, "Pix do link entra uma vez só na comanda (webhook repetido)");
  await fecharComanda(s, com6);
  const hoje = dataLocal(Date.now());
  const conc = await conciliacao(hoje, hoje);
  const online = conc.linhas.find((l) => l.forma === "ONLINE");
  const credito = conc.linhas.find((l) => l.forma === "CREDITO");
  ok(!!online && online.brutoCentavos >= 4500 + 9000 + 1500 + 4321 * 3, `conciliação: links e antecipados entram como ONLINE (${online?.brutoCentavos})`);
  const creditoSemLink = (await db.pagamentoComanda.aggregate({ where: { status: "PAGO", forma: "CREDITO", antecipadoId: null, linkPagamentoId: null, pagoEm: { gte: new Date(Date.now() - 86_400_000) } }, _sum: { valorCentavos: true } }))._sum.valorCentavos ?? 0;
  ok((credito?.brutoCentavos ?? 0) <= creditoSemLink, "conciliação: o crédito do link não conta de novo como maquininha");
  const res = await resumoMes(hoje.slice(0, 7));
  ok((res.receitas.links?.total ?? 0) >= 4500 + 9000 + 1500 && res.receitas.comandas.pagoPorLink >= 10500, "resumo: links contam uma vez (fora da receita da comanda)");

  // ---- 7) cancelamento, expiracao e comanda encerrada
  const { link: l7 } = await criarLink(s, { clienteId: cliente.id, descricao: "Sinal do evento", valorCentavos: 2000, validadeDias: 3, parcelasMax: 1 });
  await pagarLink(l7.token, { forma: "PIX" });
  const o7 = orders.get((await db.linkPagamento.findUniqueOrThrow({ where: { id: l7.id } })).gatewayId!)!;
  await cancelarLink(s, l7.id);
  ok((await db.linkPagamento.findUniqueOrThrow({ where: { id: l7.id } })).status === "CANCELADO" && o7.charges[0].status === "canceled", "cancelar o link cancela o Pix na Pagar.me");
  ok((await falha(() => pagarLink(l7.token, { forma: "PIX" })))?.codigo === "fechado", "link cancelado não aceita pagamento");
  const { link: l8 } = await criarLink(s, { clienteId: cliente.id, descricao: "Vence já", valorCentavos: 1000, validadeDias: 1, parcelasMax: 1 });
  await db.linkPagamento.update({ where: { id: l8.id }, data: { expiraEm: new Date(Date.now() - 1000) } });
  ok((await linkPublico(l8.token)).checkout.status === "EXPIRADO", "link vencido aparece como expirado");
  await sincronizarLinksPendentes();
  ok((await db.linkPagamento.findUniqueOrThrow({ where: { id: l8.id } })).status === "EXPIRADO", "rotina marca o link vencido como EXPIRADO");
  const { id: com9 } = await abrirComanda(s, { clienteId: cliente.id });
  await adicionarAvulso(s, com9, "Produto (teste)", 3000, 1);
  const { link: l9 } = await criarLink(s, { comandaId: com9, descricao: "Comanda", valorCentavos: 3000, validadeDias: 1, parcelasMax: 1 });
  await db.$transaction((tx) => tx.pagamentoComanda.create({ data: { comandaId: com9, forma: "DINHEIRO", valorCentavos: 3000, status: "PAGO", pagoEm: new Date() } }));
  await fecharComanda(s, com9);
  let st9 = "PENDENTE";
  for (let i = 0; i < 30 && st9 === "PENDENTE"; i++) { await esperar(100); st9 = (await db.linkPagamento.findUniqueOrThrow({ where: { id: l9.id } })).status; }
  ok(st9 === "CANCELADO", "comanda paga no balcão: o link dela é cancelado");

  // ---- 8) checkout do plano: aba Pix gera o 1o mes; depois troca para cartao
  const plano = await db.plano.findFirstOrThrow({ where: { nome: "Plano Corte" } });
  const cliPlano = await db.cliente.create({ data: { telefone: TEL[3], nome: "Plano Checkout", cpf: "52998224725", email: "plano@example.com" } });
  // Cadastro antigo na Celcash: na Pagar.me vira cliente novo.
  await db.assinatura.create({ data: { clienteId: cliPlano.id, planoId: plano.id, formaPagamento: "PIX", precoCentavos: 100, origem: "SITE", status: "CANCELADA", gatewayClienteId: "celcli_77", gatewayId: "celsub_77" } });
  const rp = await assinar({ clienteId: cliPlano.id, planoId: plano.id, forma: "CARTAO", origem: "SITE" });
  const ap = await db.assinatura.findUniqueOrThrow({ where: { id: rp.assinatura.id } });
  ok(!!ap.gatewayClienteId?.startsWith("cus_"), "cliente com cadastro antigo da Celcash ganha cadastro novo na Pagar.me");
  await pagarPlanoComPix(ap.tokenPublico!);
  const ck = await checkoutDaAssinatura(ap.tokenPublico!);
  ok(ck.status === "PENDENTE" && ck.forma === "PIX" && !!ck.pix?.copiaECola, "aba Pix do plano: 1º mês aparece no checkout");
  const pixPlano = await db.cobranca.findFirstOrThrow({ where: { assinaturaId: ap.id } });
  const r8 = await ativarComCartao(ap.tokenPublico!, "token_bom");
  ok(r8.status === "ATIVA" && charges.get(pixPlano.gatewayId)?.status === "canceled", "trocou para cartão: Pix do 1º mês cancelado e plano ATIVO");

  // ---- 9) roteamento por prefixo: registros da Celcash continuam na Celcash
  const antesCel = chamadas.length;
  const aCel = await db.assinatura.create({ data: { clienteId: cliente.id, planoId: plano.id, formaPagamento: "PIX", precoCentavos: 7000, origem: "SITE", status: "PENDENTE", gatewayId: "celsub_555", gatewayClienteId: "celcli_555" } });
  await sincronizarAssinatura(aCel.id);
  ok(contar("celcash", antesCel) > 0 && contar("pagarme", antesCel) === 0, "assinatura celsub_ sincroniza na Celcash (nada vai para a Pagar.me)");
  ok((await db.assinatura.findUniqueOrThrow({ where: { id: aCel.id } })).status === "ATIVA", "mensalidade paga na Celcash ativa a assinatura");
  const antesEvt = chamadas.length;
  await processarEventoGateway(`tchk_cel_${Date.now()}`, "transaction.updateStatus", "celtx_9001");
  ok(contar("celcash", antesEvt) > 0 && contar("pagarme", antesEvt) === 0, "evento de cobrança celtx_ é buscado na Celcash");
  const ag10 = await marcar();
  const ant10 = await db.pagamentoAntecipado.create({ data: { agendamentoId: ag10.id, clienteId: cliente.id, valorCentavos: 4321, forma: "PIX", gatewayId: "celchg_321", link: "https://celcash/pix" } });
  const antesAnt = chamadas.length;
  await sincronizarAntecipado(ant10.id);
  ok(contar("celcash", antesAnt) > 0 && contar("pagarme", antesAnt) === 0 && (await db.pagamentoAntecipado.findUniqueOrThrow({ where: { id: ant10.id } })).status === "PAGO", "antecipado celchg_ confirmado pela Celcash");
  const antesRot = chamadas.length;
  await rodarRotinaDePagamentos();
  ok(chamadas.slice(antesRot).some((c) => c.host === "celcash" && c.caminho === "/subscriptions"), "rotina horária (provedor pagarme) segue sincronizando as assinaturas da Celcash");
  const antesCan = chamadas.length;
  await cancelar(aCel.id, "teste", null, { avisar: false });
  ok(chamadas.slice(antesCan).some((c) => c.host === "celcash" && c.metodo === "DELETE") && contar("pagarme", antesCan) === 0, "cancelar assinatura celsub_ cancela na Celcash");

  await limpar();
  console.log(process.exitCode ? "\nAlgum teste FALHOU." : "\nTodos os testes passaram.");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
