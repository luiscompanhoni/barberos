// Teste de integracao do cancelamento com retencao contra o banco de DESENVOLVIMENTO, com uma
// Pagar.me FALSA e uma Celcash FALSA em memoria (qualquer outro endereco derruba o teste).
// Cria e apaga os proprios dados. Rodar: npm run teste:cancelamento
process.env.PAGAMENTOS_PROVIDER = "pagarme";
process.env.PAGARME_SECRET_KEY = "sk_test_falsa";
process.env.CELCASH_GALAX_ID = "falso";
process.env.CELCASH_GALAX_HASH = "falso";
delete process.env.CELCASH_AMBIENTE;
process.env.WHATSAPP_PROVIDER = "simulador";
process.env.COBRANCA_ENDERECO ||= "50, Rua Teste, Centro"; process.env.COBRANCA_CEP ||= "89160161"; process.env.COBRANCA_CIDADE ||= "Rio do Sul"; process.env.COBRANCA_UF ||= "SC";

import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal, somarDias } from "@/lib/agenda/tempo";
import { ativarComCartao } from "@/lib/assinaturas/cartao-pix";
import { sincronizarAssinatura, cobrancaEmAberto } from "@/lib/assinaturas/cobrancas";
import { aceitarDesconto, cancelarPeloCliente, falarComGerente, pausar, previaCancelamento, salvarConfigRetencao } from "@/lib/assinaturas/retencao";
import { CONFIG_PADRAO, MOTIVOS, type Motivo } from "@/lib/assinaturas/retencao-regras";
import { encerrarCancelados, reativarPausas } from "@/lib/assinaturas/retencao-rotina";
import { gerarPixDoProximoMes } from "@/lib/assinaturas/rotina";
import { assinar, situacaoDoCliente } from "@/lib/assinaturas/servico";
import { executarCancelamento } from "@/lib/bot/ferramentas-cancelamento";
import { db } from "@/lib/db";
import { _usarFetch } from "@/lib/pagamentos/pagarme";
import { _usarFetch as usarFetchRetencao } from "@/lib/pagamentos/retencao-gateway";

const ok = (c: boolean, msg: string) => { console.log(`${c ? "OK  " : "FALHOU"} ${msg}`); if (!c) process.exitCode = 1; };
const falha = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e) { return e as Error & { codigo?: string }; } };
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DIA = 86_400_000;

// ------------------------------------------------------------------ Pagar.me e Celcash falsas
type Charge = { id: string; amount: number; status: string; payment_method: string; created_at: string; paid_at?: string; due_at?: string;
  invoice?: { id: string; subscriptionId: string }; last_transaction: Record<string, string> };
const charges = new Map<string, Charge>();
const invoices: { id: string; sub: string; charge: string }[] = [];
const chamadas: { host: string; metodo: string; caminho: string; corpo: Record<string, unknown> }[] = [];
let seq = 0;
const nid = (p: string) => `${p}_${Date.now().toString(36)}${++seq}`;
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status });

function pagarme(metodo: string, caminho: string, corpo: Record<string, any>, u: URL) { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (metodo === "POST" && caminho === "/customers") return json({ id: nid("cus") });
  if (metodo === "POST" && caminho === "/orders") {
    const ch: Charge = { id: nid("ch"), amount: corpo.items[0].amount, status: "pending", payment_method: "pix", created_at: new Date().toISOString(),
      last_transaction: { qr_code: `PIXFALSO${seq}`, qr_code_url: "https://exemplo/qr.png", expires_at: new Date(Date.now() + DIA).toISOString() } };
    charges.set(ch.id, ch);
    return json({ id: nid("or"), status: "pending", charges: [ch] });
  }
  if (metodo === "POST" && caminho === "/subscriptions") {
    const sub = nid("sub");
    const agora = new Date().toISOString();
    const ch: Charge = { id: nid("ch"), amount: corpo.items[0].pricing_scheme.price, status: "paid", payment_method: "credit_card",
      created_at: agora, due_at: agora, paid_at: agora, invoice: { id: nid("in"), subscriptionId: sub }, last_transaction: {} };
    charges.set(ch.id, ch);
    invoices.push({ id: ch.invoice!.id, sub, charge: ch.id });
    return json({ id: sub });
  }
  if (metodo === "PATCH" && /^\/subscriptions\/sub_[^/]+\/billing-date$/.test(caminho)) return json({ id: caminho.split("/")[2], next_billing_at: corpo.next_billing_at });
  if (metodo === "POST" && /^\/subscriptions\/sub_[^/]+\/discounts$/.test(caminho)) return json({ id: nid("dis"), ...corpo, status: "active" });
  if (metodo === "DELETE" && /^\/subscriptions\/sub_[^/]+$/.test(caminho)) return json({ id: caminho.split("/")[2], status: "canceled" });
  if (caminho === "/invoices") return json({ data: invoices.filter((i) => i.sub === u.searchParams.get("subscription_id")).map((i) => ({ id: i.id, charge: { id: i.charge } })) });
  const m = caminho.match(/^\/charges\/(.+)$/);
  if (m && charges.has(m[1])) {
    if (metodo === "DELETE") charges.get(m[1])!.status = "canceled";
    return json(charges.get(m[1]));
  }
  return json({ message: `rota falsa nao implementada: ${metodo} ${caminho}` }, 404);
}

function celcash(metodo: string, caminho: string) {
  if (caminho === "/token") return json({ access_token: "tok_falso", expires_in: 600 });
  if (metodo === "DELETE") return json({ type: true });
  return json({ error: { message: `rota falsa nao implementada: ${metodo} ${caminho}` } }, 404);
}

const falsa = (async (url: string | URL, init?: RequestInit) => {
  const u = new URL(String(url));
  const metodo = init?.method ?? "GET";
  const corpo = init?.body ? JSON.parse(String(init.body)) : {};
  if (u.host === "api.pagar.me") {
    const caminho = u.pathname.replace("/core/v5", "");
    chamadas.push({ host: "pagarme", metodo, caminho, corpo });
    return pagarme(metodo, caminho, corpo, u);
  }
  if (u.host === "api.sandbox.cel.cash") {
    const caminho = u.pathname.replace("/v2", "");
    chamadas.push({ host: "celcash", metodo, caminho, corpo });
    return celcash(metodo, caminho);
  }
  throw new Error(`Chamada externa proibida no teste: ${u.href}`);
}) as typeof fetch;
globalThis.fetch = falsa;
_usarFetch(falsa);
usarFetchRetencao(falsa);
const desde = (n: number, host?: string) => chamadas.slice(n).filter((c) => !host || c.host === host);

// ------------------------------------------------------------------ dados
const TEL = Array.from({ length: 14 }, (_, i) => `55119333370${String(i).padStart(2, "0")}`);
const NOME = "Teste Cancel";

async function limpar() {
  for (const tel of TEL) {
    const c = await db.cliente.findUnique({ where: { telefone: tel } });
    if (c) {
      await db.agendamento.deleteMany({ where: { clienteId: c.id } });
      await db.assinatura.deleteMany({ where: { clienteId: c.id } });
    }
    const conv = await db.conversa.findUnique({ where: { telefone: tel } });
    if (conv) { await db.mensagem.deleteMany({ where: { conversaId: conv.id } }); await db.conversa.delete({ where: { id: conv.id } }); }
    if (c) await db.cliente.delete({ where: { id: c.id } });
  }
  // Avisos que foram para o dono.
  await db.mensagem.deleteMany({ where: { texto: { contains: NOME }, conversa: { telefone: { notIn: TEL } } } });
}

async function mensagem(tel: string, trecho: string) {
  for (let i = 0; i < 40; i++) {
    const m = await db.mensagem.findFirst({ where: { conversa: { telefone: tel }, texto: { contains: trecho } } });
    if (m) return m;
    await esperar(100);
  }
  return null;
}

async function main() {
  await limpar();
  const configAntes = await db.retencaoConfig.findUnique({ where: { id: 1 } });
  await salvarConfigRetencao(CONFIG_PADRAO, null);
  const cfg = await configuracao();
  const hoje = dataLocal(Date.now(), cfg.fuso);
  const plano = await db.plano.findFirstOrThrow({ where: { nome: "Plano Corte" } });
  const dono = await db.usuario.findFirstOrThrow({ where: { papel: "DONO", ativo: true } });
  let i = 0;
  const novoCliente = (sufixo: string) => db.cliente.create({ data: { telefone: TEL[i++], nome: `${NOME} ${sufixo}`, cpf: "52998224725", email: `cancel${i}@example.com` } });
  /** Assinatura ativa direto no banco (mes pago ate daqui a 20 dias). */
  const ativa = async (sufixo: string, gatewayId: (id: string) => string | null, extra: object = {}) => {
    const c = await novoCliente(sufixo);
    const a = await db.assinatura.create({
      data: { clienteId: c.id, planoId: plano.id, formaPagamento: "PIX", precoCentavos: 10000, origem: "SITE", status: "ATIVA",
        proximoVencimento: new Date(`${somarDias(hoje, 20)}T00:00:00Z`), cicloInicio: new Date(`${somarDias(hoje, -10)}T00:00:00Z`), ativadaEm: new Date(), ...extra },
    });
    const g = gatewayId(a.id);
    return { c, a: g ? await db.assinatura.update({ where: { id: a.id }, data: { gatewayId: g, gatewayClienteId: "cus_falso" } }) : a };
  };

  // ---- 1) oferta e cancelamento com cada motivo (Pix do BarberOS)
  const esperado: Record<Motivo, string> = { PRECO: "DESCONTO", NAO_USA: "PAUSA", VIAGEM: "PAUSA", MUDANCA: "NENHUMA", HORARIOS: "GERENTE", INSATISFEITO: "GERENTE", OUTRO: "NENHUMA" };
  for (const motivo of MOTIVOS) {
    const { c, a } = await ativa(motivo, (id) => `pixrec_${id}`);
    const pv = await previaCancelamento(a.id, motivo);
    ok(pv.oferta.tipo === esperado[motivo] && !pv.cancelamento.imediato, `${motivo}: oferta ${pv.oferta.tipo}, vale até ${pv.cancelamento.ultimoDia}`);
    const n = chamadas.length;
    const r = await cancelarPeloCliente({ assinaturaId: a.id, motivo, detalhe: motivo === "OUTRO" ? "abri barbearia" : null, origem: "SITE" });
    const depois = await db.assinatura.findUniqueOrThrow({ where: { id: a.id } });
    ok(r.ultimoDia === somarDias(hoje, 19) && depois.status === "ATIVA" && depois.encerraEm?.toISOString().slice(0, 10) === somarDias(hoje, 20) && desde(n).length === 0,
      `${motivo}: cancelado no fim do ciclo (vale até ${r.ultimoDia}), sem chamar gateway (Pix do BarberOS)`);
    const log = await db.retencaoAssinatura.findFirst({ where: { assinaturaId: a.id, desfecho: "CANCELOU", motivo } });
    ok(!!log, `${motivo}: registrado no indicador`);
    ok((await situacaoDoCliente(c.id))?.valida === true, `${motivo}: plano continua valendo até o fim do ciclo`);
  }
  const ultimo = await db.assinatura.findFirstOrThrow({ where: { cliente: { telefone: TEL[MOTIVOS.length - 1] } } });
  ok(!!(await falha(() => cancelarPeloCliente({ assinaturaId: ultimo.id, motivo: "OUTRO", origem: "SITE" })))?.message.includes("já está cancelado"), "cancelar de novo: avisa que já está cancelado");

  // fim do ciclo: a rotina encerra
  await db.assinatura.update({ where: { id: ultimo.id }, data: { encerraEm: new Date(`${hoje}T00:00:00Z`) } });
  await encerrarCancelados();
  ok((await db.assinatura.findUniqueOrThrow({ where: { id: ultimo.id } })).status === "CANCELADA", "rotina: no fim do ciclo a assinatura vira CANCELADA");
  ok(!!(await mensagem(TEL[MOTIVOS.length - 1], "terminou o período")), "cliente avisado do fim do período");

  // ---- 2) Pix do BarberOS: aceitar desconto -> Pix seguinte sai com desconto
  const pix = await ativa("Desconto Pix", (id) => `pixrec_${id}`);
  const rd = await aceitarDesconto({ assinaturaId: pix.a.id, motivo: "PRECO", origem: "SITE" });
  ok(rd.pct === 20 && rd.meses === 2 && rd.valorCentavos === 8000, "desconto aceito: 20% por 2 mensalidades (R$ 80,00)");
  await db.assinatura.update({ where: { id: pix.a.id }, data: { proximoVencimento: new Date(`${somarDias(hoje, 2)}T00:00:00Z`), descontoRetencaoAte: new Date(`${somarDias(hoje, 33)}T00:00:00Z`) } });
  await gerarPixDoProximoMes();
  const pixMes = await cobrancaEmAberto(pix.a.id);
  ok(pixMes?.valorCentavos === 8000, `rotina gera o Pix do mês com desconto (${pixMes?.valorCentavos})`);
  ok((await previaCancelamento(pix.a.id, "PRECO")).oferta.tipo === "NENHUMA", "desconto não é oferecido de novo no mesmo ano");
  ok(!!(await mensagem(pix.c.telefone, "20% de desconto")), "cliente recebe a confirmação do desconto no WhatsApp");
  ok(!!(await mensagem(dono.telefone, `${NOME} Desconto Pix`)), "dono recebe o aviso da retenção com o motivo");

  // ---- 3) Cartao na Pagar.me: desconto e pausa no gateway, reativacao pela rotina
  const cc = await novoCliente("Cartao");
  const rc = await assinar({ clienteId: cc.id, planoId: plano.id, forma: "CARTAO", origem: "SITE" });
  await ativarComCartao(rc.assinatura.tokenPublico!, "token_bom");
  let ac = await db.assinatura.findUniqueOrThrow({ where: { id: rc.assinatura.id } });
  ok(ac.status === "ATIVA" && !!ac.gatewayId?.startsWith("sub_"), "cartão: assinatura ativa na Pagar.me");
  let n = chamadas.length;
  await aceitarDesconto({ assinaturaId: ac.id, motivo: "PRECO", origem: "SITE" });
  const desc = desde(n, "pagarme").find((c) => c.caminho.endsWith("/discounts"));
  ok(desc?.metodo === "POST" && desc.corpo.value === 20 && desc.corpo.discount_type === "percentage" && desc.corpo.cycles === 2, "cartão: desconto criado na assinatura da Pagar.me (20%, 2 ciclos)");
  // Desconto e pausa no mesmo cliente: libera a pausa (motivo diferente).
  const vencAntes = ac.proximoVencimento!.toISOString().slice(0, 10);
  n = chamadas.length;
  const rp = await pausar({ assinaturaId: ac.id, motivo: "VIAGEM", dias: 30, origem: "SITE" });
  const bd = desde(n, "pagarme").find((c) => c.caminho.endsWith("/billing-date"));
  ok(bd?.metodo === "PATCH" && String(bd.corpo.next_billing_at).startsWith(somarDias(vencAntes, 30)), `pausa: próxima cobrança empurrada 30 dias na Pagar.me (${bd?.corpo.next_billing_at})`);
  ok(rp.volta === somarDias(hoje, 30) && rp.proximoVencimento === somarDias(vencAntes, 30), "pausa: volta em 30 dias e o vencimento anda junto");
  let sit = await situacaoDoCliente(cc.id);
  ok(sit?.pausada === true && sit.valida === false, "pausado: não usa o plano");
  await sincronizarAssinatura(ac.id);
  ac = await db.assinatura.findUniqueOrThrow({ where: { id: ac.id } });
  ok(ac.proximoVencimento!.toISOString().slice(0, 10) === somarDias(vencAntes, 30), "sincronizar com o gateway não desfaz a pausa");
  ok(!!(await falha(() => pausar({ assinaturaId: ac.id, motivo: "NAO_USA", dias: 30, origem: "SITE" }))), "não pausa de novo enquanto pausado");
  await db.assinatura.update({ where: { id: ac.id }, data: { pausadaAte: new Date(`${hoje}T00:00:00Z`) } });
  await reativarPausas();
  sit = await situacaoDoCliente(cc.id);
  ok(sit?.pausada === false && sit.valida === true && sit.assinatura.pausadaEm === null, "rotina reativa a pausa no dia da volta");
  ok(!!(await mensagem(cc.telefone, "voltou a valer")), "cliente avisado que o plano voltou");
  // cancelar o cartao: recorrencia para na hora, plano vale ate o vencimento
  n = chamadas.length;
  const rcan = await cancelarPeloCliente({ assinaturaId: ac.id, motivo: "MUDANCA", origem: "SITE" });
  ok(desde(n, "pagarme").some((c) => c.metodo === "DELETE" && c.caminho === `/subscriptions/${ac.gatewayId}`) && !rcan.imediato,
    `cartão: assinatura cancelada na Pagar.me e o plano vale até ${rcan.ultimoDia}`);
  ok(!!(await mensagem(cc.telefone, "continua valendo até")), "cliente recebe a confirmação com a data final");

  // ---- 4) plano nunca pago: cancela na hora
  const pend = await ativa("Pendente", (id) => `pixrec_${id}`, { status: "PENDENTE", proximoVencimento: null });
  const rpend = await cancelarPeloCliente({ assinaturaId: pend.a.id, motivo: "OUTRO", detalhe: "desisti", origem: "SITE" });
  ok(rpend.imediato && (await db.assinatura.findUniqueOrThrow({ where: { id: pend.a.id } })).status === "CANCELADA", "pendente: cancela na hora");

  // ---- 5) CashBarber: so registra e avisa a equipe
  const cb = await ativa("CashBarber", (id) => `cashbarber:9:${id}`, { proximoVencimento: null, criadaEm: new Date(`${somarDias(hoje, -40)}T12:00:00Z`) });
  ok((await previaCancelamento(cb.a.id, "PRECO")).oferta.tipo === "GERENTE", "CashBarber: sem desconto automático (oferta vira gerente)");
  n = chamadas.length;
  const rcb = await cancelarPeloCliente({ assinaturaId: cb.a.id, motivo: "MUDANCA", origem: "SITE" });
  ok(desde(n).length === 0 && rcb.cashbarber && !!rcb.ultimoDia, `CashBarber: nenhuma chamada a gateway; vale até ${rcb.ultimoDia} (estimado pela adesão)`);
  ok(!!(await mensagem(dono.telefone, "cancele também no CashBarber")), "dono avisado para cancelar no CashBarber");

  // ---- 6) Celcash pelo prefixo: cancela na Celcash, nada na Pagar.me
  const cel = await ativa("Celcash", () => "celsub_4242");
  ok((await previaCancelamento(cel.a.id, "VIAGEM")).oferta.tipo === "GERENTE", "Celcash: sem pausa automática (oferta vira gerente)");
  n = chamadas.length;
  await cancelarPeloCliente({ assinaturaId: cel.a.id, motivo: "PRECO", origem: "SITE" });
  ok(desde(n, "celcash").some((c) => c.metodo === "DELETE" && c.caminho.includes("4242")) && desde(n, "pagarme").length === 0, "celsub_: cancelado na Celcash (nada vai para a Pagar.me)");

  // ---- 7) insatisfeito: conversa vai para o gerente
  const ins = await ativa("Gerente", (id) => `pixrec_${id}`);
  await falarComGerente({ assinaturaId: ins.a.id, motivo: "INSATISFEITO", detalhe: "corte saiu torto", origem: "SITE" });
  const conv = await db.conversa.findUniqueOrThrow({ where: { telefone: ins.c.telefone } });
  ok(conv.estado === "HUMANO" && !!(await mensagem(ins.c.telefone, "corte saiu torto")), "gerente: conversa passa para a equipe com o motivo");
  ok(!!(await mensagem(ins.c.telefone, "O gerente vai falar com você")) && !!(await mensagem(dono.telefone, `${NOME} Gerente`)), "gerente: cliente e dono avisados");

  // ---- 8) bot: mesmas ofertas e mesmo servico
  const bot = await ativa("Bot", (id) => `pixrec_${id}`);
  const ctx = { conversaId: (await db.conversa.create({ data: { telefone: bot.c.telefone, clienteId: bot.c.id } })).id, telefone: bot.c.telefone, nomePerfil: null };
  const tOferta = await executarCancelamento("oferta_cancelamento", { motivo: "NAO_USA" }, ctx);
  ok(tOferta.texto.includes("pausar") && tOferta.texto.includes("30, 60"), "bot: oferta de pausa igual à do site");
  const tPausa = await executarCancelamento("cancelar_assinatura", { motivo: "NAO_USA", decisao: "pausar", dias: 60 }, ctx);
  ok(tPausa.texto.includes("pausado") && (await db.retencaoAssinatura.count({ where: { assinaturaId: bot.a.id, desfecho: "PAUSA", origem: "BOT" } })) === 1, "bot: pausa registrada com origem BOT");
  const tCan = await executarCancelamento("cancelar_assinatura", { motivo: "MUDANCA", decisao: "cancelar" }, ctx);
  ok(tCan.texto.includes("Continua valendo até"), "bot: cancela no fim do ciclo");

  // limpa
  if (configAntes) await db.retencaoConfig.update({ where: { id: 1 }, data: configAntes });
  else await db.retencaoConfig.deleteMany({ where: { id: 1 } });
  await esperar(500); // avisos em segundo plano
  await limpar();
  console.log(process.exitCode ? "\nAlgum teste FALHOU." : "\nTodos os testes passaram.");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
