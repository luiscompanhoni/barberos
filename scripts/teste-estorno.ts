// Teste de integracao dos estornos (pedido da recepcao -> aprovacao do dono -> execucao) contra o banco de
// DESENVOLVIMENTO, com uma Pagar.me FALSA em memoria (qualquer outra chamada externa derruba o teste).
// Cria e apaga os proprios dados. Rodar: npm run teste:estorno
process.env.PAGAMENTOS_PROVIDER = "pagarme";
process.env.PAGARME_SECRET_KEY = "sk_test_falsa";
process.env.WHATSAPP_PROVIDER = "simulador";

import { randomBytes } from "node:crypto";
import { dataLocal } from "@/lib/agenda/tempo";
import type { Sessao } from "@/lib/auth/sessao";
import { cancelarPagamento } from "@/lib/comandas/maquininha";
import { detalheComanda } from "@/lib/comandas/servico";
import { db } from "@/lib/db";
import { contarPendentes, decidirEstorno, infoAlvo, listarEstornos, pedirEstorno } from "@/lib/estornos/servico";
import { abrirCaixa, caixaAberto, resumoCaixa } from "@/lib/financeiro/caixa";
import { conciliacao } from "@/lib/financeiro/conciliacao";
import { extratoCaixa } from "@/lib/financeiro/extrato";
import { resumoMes } from "@/lib/financeiro/resumo";
import { _usarFetch } from "@/lib/pagamentos/pagarme";
import { horarioLivre } from "./util-teste";

const ok = (c: boolean, msg: string) => { console.log(`${c ? "OK  " : "FALHOU"} ${msg}`); if (!c) process.exitCode = 1; };
const falha = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e) { return e as Error & { codigo?: string; status?: number }; } };

// ------------------------------------------------------------------ Pagar.me falsa
type Charge = { id: string; amount: number; status: string; payment_method: string; canceled_amount: number; pos?: boolean; falhar?: boolean; last_transaction?: Record<string, string> };
const orders = new Map<string, { id: string; status: string; charges: Charge[] }>();
const charges = new Map<string, Charge>();
const estornos: { charge: string; amount: number | null }[] = [];
let seq = 0;
const nid = (p: string) => `${p}_${Date.now().toString(36)}${++seq}`;
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status });

const falsa = (async (url: string | URL, init?: RequestInit) => {
  const u = new URL(String(url));
  if (u.host !== "api.pagar.me") throw new Error(`Chamada externa proibida no teste: ${u.href}`);
  const caminho = u.pathname.replace("/core/v5", "");
  const metodo = init?.method ?? "GET";
  const corpo = init?.body ? JSON.parse(String(init.body)) : {};
  let m = caminho.match(/^\/orders\/([^/]+)$/);
  if (metodo === "GET" && m && orders.has(m[1])) return json(orders.get(m[1]));
  m = caminho.match(/^\/charges\/([^/]+)$/);
  if (metodo === "DELETE" && m && charges.has(m[1])) {
    const ch = charges.get(m[1])!;
    if (ch.pos) return json({ message: "Charge cannot be canceled by API" }, 422);
    if (ch.falhar) return json({ message: "Erro no adquirente" }, 500);
    const valor = corpo.amount ?? ch.amount - ch.canceled_amount;
    estornos.push({ charge: ch.id, amount: corpo.amount ?? null });
    ch.canceled_amount += valor;
    const pix = ch.payment_method === "pix";
    const total = ch.canceled_amount >= ch.amount;
    if (total) ch.status = pix ? "pending_refund" : "refunded";
    ch.last_transaction = { id: nid("tran"), status: pix ? "pending_refund" : "refunded" };
    return json(ch);
  }
  return json({ message: `rota falsa nao implementada: ${metodo} ${caminho}` }, 404);
}) as typeof fetch;
globalThis.fetch = falsa;
_usarFetch(falsa);

/** Pedido ja pago na Pagar.me (online ou maquininha). */
function pedidoPago(valor: number, metodo: "pix" | "credit_card", extra: Partial<Charge> = {}) {
  const ch: Charge = { id: nid("ch"), amount: valor, status: "paid", payment_method: metodo, canceled_amount: 0, ...extra };
  const o = { id: nid("or"), status: "paid", charges: [ch] };
  orders.set(o.id, o);
  charges.set(ch.id, ch);
  return o;
}

// ------------------------------------------------------------------ dados
const TAG = "[teste estorno]";
const TEL_CLI = "5511933336001";
const TEL_REC = "5511933336002";
const inicio = new Date();

async function limpar() {
  await db.pedidoEstorno.deleteMany({ where: { clienteNome: { startsWith: TAG } } });
  const cli = await db.cliente.findUnique({ where: { telefone: TEL_CLI } });
  const comandas = await db.comanda.findMany({ where: { OR: [{ nomeAvulso: { startsWith: TAG } }, ...(cli ? [{ clienteId: cli.id }] : [])] }, select: { id: true } });
  const ids = comandas.map((c) => c.id);
  await db.pagamentoComanda.deleteMany({ where: { comandaId: { in: ids } } });
  await db.itemComanda.deleteMany({ where: { comandaId: { in: ids } } });
  await db.linkPagamento.deleteMany({ where: { telefone: TEL_CLI } });
  await db.comanda.deleteMany({ where: { id: { in: ids } } });
  if (cli) {
    await db.pagamentoAntecipado.deleteMany({ where: { clienteId: cli.id } });
    await db.agendamento.deleteMany({ where: { clienteId: cli.id } });
    await db.assinatura.deleteMany({ where: { clienteId: cli.id } });
    await db.cliente.deleteMany({ where: { id: cli.id } });
  }
  for (const tel of [TEL_CLI, TEL_REC]) {
    const conv = await db.conversa.findUnique({ where: { telefone: tel } });
    if (conv) { await db.mensagem.deleteMany({ where: { conversaId: conv.id } }); await db.conversa.deleteMany({ where: { id: conv.id } }); }
  }
  await db.mensagem.deleteMany({ where: { criadoEm: { gte: inicio }, texto: { contains: "Pedido de estorno" } } });
  await db.usuario.deleteMany({ where: { telefone: TEL_REC } });
}

async function main() {
  await limpar();
  const dono = await db.usuario.findFirstOrThrow({ where: { papel: "DONO", ativo: true } });
  const sd: Sessao = { usuarioId: dono.id, papel: "DONO", nome: dono.nome, barbeiroId: null, clienteId: null };
  const rec = await db.usuario.create({ data: { telefone: TEL_REC, nome: `${TAG} Recepção`, papel: "RECEPCAO" } });
  const sr: Sessao = { usuarioId: rec.id, papel: "RECEPCAO", nome: rec.nome, barbeiroId: null, clienteId: null };
  const cliente = await db.cliente.create({ data: { telefone: TEL_CLI, nome: `${TAG} Cliente`, cpf: "52998224725", email: "estorno@example.com" } });
  const hoje = dataLocal(Date.now());
  const [resAntes, concAntes] = await Promise.all([resumoMes(hoje.slice(0, 7)), conciliacao(hoje, hoje)]);
  const online = (c: Awaited<ReturnType<typeof conciliacao>>) => c.linhas.find((l) => l.forma === "ONLINE")?.estornoCentavos ?? 0;
  // Nao mexe em caixa de verdade aberto no banco de desenvolvimento.
  const jaAberto = await caixaAberto();
  if (jaAberto) await db.caixa.update({ where: { id: jaAberto.id }, data: { status: "FECHADO", fechadoEm: new Date(), observacao: "fechado pelo teste de estorno" } });
  let caixaTeste: string | null = null;
  const comanda = (p: { total: number; status?: "ABERTA" | "FECHADA"; pag: { forma: "DINHEIRO" | "PIX" | "CREDITO" | "DEBITO"; v: number; gatewayPedidoId?: string; status?: "PAGO" | "AGUARDANDO"; por?: string; antecipadoId?: string }[] }) =>
    db.comanda.create({
      data: {
        nomeAvulso: `${TAG} Avulso`, status: p.status ?? "FECHADA", fechadaEm: (p.status ?? "FECHADA") === "FECHADA" ? new Date() : null,
        itens: { create: [{ descricao: "Corte (teste)", precoUnitCentavos: p.total }] },
        pagamentos: {
          create: p.pag.map((x) => ({
            forma: x.forma, valorCentavos: x.v, status: x.status ?? "PAGO", pagoEm: (x.status ?? "PAGO") === "PAGO" ? new Date() : null,
            gatewayPedidoId: x.gatewayPedidoId, registradoPorId: x.por ?? null, antecipadoId: x.antecipadoId,
          })),
        },
      },
      include: { pagamentos: true },
    });

  try {
    // ---- 1) recepcao pede -> dono aprova -> executa (link pago na Pagar.me)
    const o1 = pedidoPago(4500, "credit_card");
    const l1 = await db.linkPagamento.create({
      data: { token: randomBytes(8).toString("hex"), descricao: `${TAG} Pomada`, valorCentavos: 4500, clienteId: cliente.id, nome: cliente.nome, telefone: TEL_CLI,
        status: "PAGO", forma: "CARTAO", gatewayId: o1.id, pagoEm: new Date(), expiraEm: new Date(Date.now() + 86_400_000) },
    });
    const pendAntes = await contarPendentes();
    const p1 = await pedirEstorno(sr, { tipo: "LINK", referenciaId: l1.id, valorCentavos: 4500, motivo: "Cliente devolveu a pomada" });
    ok(p1.status === "PENDENTE" && (await contarPendentes()) === pendAntes + 1, "recepção pede: pedido fica PENDENTE e conta no selo de pendências");
    ok(estornos.length === 0, "nada é devolvido antes do dono aprovar");
    const aviso = await db.mensagem.findFirst({ where: { conversa: { telefone: dono.telefone }, criadoEm: { gte: inicio }, texto: { contains: "Pedido de estorno" } }, orderBy: { criadoEm: "desc" } });
    ok(!!aviso && aviso.texto.includes("Cliente devolveu a pomada") && aviso.texto.includes("/financeiro?aba=estornos"), "dono avisado no WhatsApp com motivo e link do painel");
    ok((await falha(() => decidirEstorno(sr, p1.id, { acao: "aprovar" })))?.status === 403, "recepção não aprova o próprio pedido");
    ok((await falha(() => pedirEstorno(sr, { tipo: "LINK", referenciaId: l1.id, valorCentavos: 100, motivo: "de novo" }))) !== null, "não dá para pedir de novo por cima do pedido pendente");
    const a1 = await decidirEstorno(sd, p1.id, { acao: "aprovar" });
    ok(a1.status === "EXECUTADO" && estornos.at(-1)?.charge === o1.charges[0].id && estornos.at(-1)?.amount === null, "dono aprova: estorno total na Pagar.me (DELETE /charges sem amount)");
    ok((await db.linkPagamento.findUniqueOrThrow({ where: { id: l1.id } })).status === "ESTORNADO", "link vira ESTORNADO");
    ok((await falha(() => decidirEstorno(sd, p1.id, { acao: "aprovar" })))?.codigo === "ja_decidido", "aprovar duas vezes não executa de novo");
    ok((await db.auditoria.count({ where: { entidade: "estorno", entidadeId: p1.id } })) >= 3, "pedido, aprovação e execução auditados");

    // ---- 2) recusa (com motivo obrigatorio); depois da recusa pode pedir de novo
    const c2 = await comanda({ total: 3000, pag: [{ forma: "DEBITO", v: 3000 }] });
    const p2 = await pedirEstorno(sr, { tipo: "COMANDA", referenciaId: c2.pagamentos[0].id, valorCentavos: 3000, motivo: "Cobrou errado" });
    ok((await falha(() => decidirEstorno(sd, p2.id, { acao: "recusar" }))) !== null, "recusar exige motivo");
    const r2 = await decidirEstorno(sd, p2.id, { acao: "recusar", motivo: "Cliente usou o serviço" });
    ok(r2.status === "RECUSADO" && r2.motivoDecisao === "Cliente usou o serviço", "dono recusa com motivo");
    ok((await db.pagamentoComanda.findUniqueOrThrow({ where: { id: c2.pagamentos[0].id } })).status === "PAGO", "recusado: pagamento continua PAGO");
    ok((await infoAlvo(sr, "COMANDA", c2.pagamentos[0].id)).limite === 3000, "depois da recusa o valor volta a ficar disponível");

    // ---- 3) parcial: horario pago antes no Pix (ja na comanda), dono estorna direto parte
    const barbeiro = await db.barbeiro.findFirstOrThrow({ where: { ativo: true } });
    const servico = await db.servico.findFirstOrThrow({ where: { ativo: true } });
    const ini = await horarioLivre(barbeiro.id, new Date(Date.now() - 3_600_000), 30, -30);
    const ag = await db.agendamento.create({ data: { barbeiroId: barbeiro.id, clienteId: cliente.id, servicoId: servico.id, inicio: ini, fim: new Date(+ini + 30 * 60_000), precoCentavos: 4321, origem: "SITE", status: "CONCLUIDO" } });
    const o3 = pedidoPago(4321, "pix");
    const ant = await db.pagamentoAntecipado.create({ data: { agendamentoId: ag.id, clienteId: cliente.id, valorCentavos: 4321, forma: "PIX", status: "PAGO", gatewayId: o3.id, pagoEm: new Date() } });
    const c3 = await comanda({ total: 4321, pag: [{ forma: "PIX", v: 4321, antecipadoId: ant.id }] });
    const info3 = await infoAlvo(sd, "ANTECIPADO", ag.id);
    ok(info3.referenciaId === ant.id && info3.parcial && info3.limite === 4321, "horário pago antes: acha pelo id do horário, aceita parcial");
    const p3 = await pedirEstorno(sd, { tipo: "COMANDA", referenciaId: c3.pagamentos[0].id, valorCentavos: 1000, motivo: "Desconto combinado depois" });
    ok(p3.tipo === "ANTECIPADO" && p3.status === "EXECUTADO" && estornos.at(-1)?.amount === 1000, "dono estorna direto R$ 10,00 (amount=1000 na Pagar.me)");
    ok(!!p3.instrucao?.includes("processamento"), "Pix: devolução em processamento tratada (pending_refund)");
    const pr3 = await db.pedidoEstorno.findUniqueOrThrow({ where: { id: p3.id } });
    ok(pr3.decididoPorId === dono.id && pr3.pedidoPorId === dono.id, "estorno direto fica registrado como aprovado pelo dono");
    const pg3 = await db.pagamentoComanda.findUniqueOrThrow({ where: { id: c3.pagamentos[0].id } });
    ok(pg3.status === "PAGO" && pg3.estornadoCentavos === 1000 && (await db.pagamentoAntecipado.findUniqueOrThrow({ where: { id: ant.id } })).status === "PAGO", "parcial: pagamento segue PAGO com R$ 10,00 estornado");
    ok((await falha(() => pedirEstorno(sd, { tipo: "ANTECIPADO", referenciaId: ant.id, valorCentavos: 4000, motivo: "mais" })))?.message.includes("máximo") === true, "não estorna mais do que sobrou (R$ 33,21)");
    const p3b = await pedirEstorno(sd, { tipo: "ANTECIPADO", referenciaId: ant.id, valorCentavos: 3321, motivo: "Cliente desistiu" });
    ok(p3b.status === "EXECUTADO" && (await db.pagamentoAntecipado.findUniqueOrThrow({ where: { id: ant.id } })).status === "ESTORNADO", "resto estornado: horário volta a não pago (ESTORNADO)");
    const d3 = await detalheComanda(c3.id);
    ok(d3.status === "FECHADA" && d3.pagamentos[0].status === "CANCELADO" && !!d3.pagamentos[0].estornadoEm && d3.resumo.estornado === 4321 && d3.estornos.length === 2,
      "comanda fechada continua fechada, com o pagamento estornado visível");

    // ---- 4) dinheiro vira sangria (exige caixa aberto; respeita o troco)
    const c4 = await comanda({ total: 4321, pag: [{ forma: "DINHEIRO", v: 5000 }] });
    ok((await falha(() => pedirEstorno(sr, { tipo: "COMANDA", referenciaId: c4.pagamentos[0].id, valorCentavos: 4321, motivo: "Serviço mal feito" })))?.codigo === "caixa_fechado", "dinheiro sem caixa aberto: recusado");
    caixaTeste = (await abrirCaixa(sd, 10000)).id;
    const c4b = await comanda({ total: 4321, pag: [{ forma: "DINHEIRO", v: 5000 }] }); // depois da abertura: entra no turno
    ok((await falha(() => pedirEstorno(sr, { tipo: "COMANDA", referenciaId: c4b.pagamentos[0].id, valorCentavos: 5000, motivo: "Serviço mal feito" })))?.message.includes("43,21") === true, "não devolve o troco: máximo R$ 43,21");
    const p4 = await pedirEstorno(sr, { tipo: "COMANDA", referenciaId: c4b.pagamentos[0].id, valorCentavos: 4321, motivo: "Serviço mal feito" });
    const a4 = await decidirEstorno(sd, p4.id, { acao: "aprovar" });
    const mov = a4.status === "EXECUTADO" ? await db.movimentoCaixa.findFirst({ where: { caixaId: caixaTeste, tipo: "SANGRIA" } }) : null;
    ok(!!mov && mov.valorCentavos === 4321 && mov.motivo.startsWith("Estorno:"), "aprovado: vira SANGRIA no caixa aberto (motivo “Estorno: …”)");
    const rc = await resumoCaixa((await caixaAberto())!);
    ok(rc.esperado === 10000 + 5000 - 679 - 4321 && rc.sangrias === 4321, `dinheiro esperado na gaveta desconta o estorno uma vez só (${rc.esperado})`);

    // ---- 5) Celcash vira manual (mensalidade); mensalidade so total
    const plano = await db.plano.findFirstOrThrow();
    const ass = await db.assinatura.create({ data: { clienteId: cliente.id, planoId: plano.id, formaPagamento: "PIX", precoCentavos: 7000, origem: "SITE", status: "ATIVA", gatewayId: `celsub_${Date.now()}` } });
    const cob = await db.cobranca.create({ data: { assinaturaId: ass.id, gatewayId: `celtx_${Date.now()}`, valorCentavos: 7000, vencimento: new Date(`${hoje}T00:00:00Z`), status: "PAGA", pagaEm: new Date(), forma: "PIX" } });
    ok((await falha(() => pedirEstorno(sd, { tipo: "MENSALIDADE", referenciaId: cob.id, valorCentavos: 3500, motivo: "metade" })))?.message.includes("total") === true, "mensalidade: só estorno total");
    const p5 = await pedirEstorno(sd, { tipo: "MENSALIDADE", referenciaId: cob.id, valorCentavos: 7000, motivo: "Cobrado depois do cancelamento" });
    ok(p5.status === "MANUAL" && !!p5.instrucao?.includes("Celcash"), "Celcash: fica MANUAL com “estornar manualmente no painel da Celcash”");
    ok((await db.cobranca.findUniqueOrThrow({ where: { id: cob.id } })).status === "ESTORNADA", "mensalidade fica ESTORNADA");

    // ---- 6) maquininha: a API nao cancela -> instrui estornar na maquininha
    const o6 = pedidoPago(8000, "credit_card", { pos: true });
    const c6 = await comanda({ total: 8000, pag: [{ forma: "CREDITO", v: 8000, gatewayPedidoId: o6.id }] });
    const p6 = await pedirEstorno(sd, { tipo: "COMANDA", referenciaId: c6.pagamentos[0].id, valorCentavos: 8000, motivo: "Cartão errado" });
    ok(p6.status === "MANUAL" && !!p6.instrucao?.includes("maquininha"), "maquininha: API recusou, instrução para estornar na própria maquininha");
    ok((await db.pagamentoComanda.findUniqueOrThrow({ where: { id: c6.pagamentos[0].id } })).status === "CANCELADO", "pagamento da maquininha marcado CANCELADO (estornado)");

    // ---- 7) gateway falha: FALHOU, tentar de novo, registrar por fora
    const o7 = pedidoPago(2000, "credit_card", { falhar: true });
    const l7 = await db.linkPagamento.create({
      data: { token: randomBytes(8).toString("hex"), descricao: `${TAG} Sinal`, valorCentavos: 2000, clienteId: cliente.id, nome: cliente.nome, telefone: TEL_CLI,
        status: "PAGO", forma: "CARTAO", gatewayId: o7.id, pagoEm: new Date(), expiraEm: new Date(Date.now() + 86_400_000) },
    });
    const p7 = await pedirEstorno(sd, { tipo: "LINK", referenciaId: l7.id, valorCentavos: 2000, motivo: "Evento cancelado" });
    ok(p7.status === "FALHOU" && !!p7.erro && (await db.linkPagamento.findUniqueOrThrow({ where: { id: l7.id } })).status === "PAGO", "gateway falhou: FALHOU com o erro e nada muda");
    ok((await decidirEstorno(sd, p7.id, { acao: "tentar" })).status === "FALHOU", "tentar de novo (ainda falha)");
    const m7 = await decidirEstorno(sd, p7.id, { acao: "manual", motivo: "Devolvido por Pix da conta da barbearia" });
    ok(m7.status === "MANUAL" && (await db.linkPagamento.findUniqueOrThrow({ where: { id: l7.id } })).status === "ESTORNADO", "registrado como devolvido por fora: link ESTORNADO");

    // ---- 8) recepcao nao estorna direto; aguardando ainda cancela
    const c8 = await comanda({ total: 6000, status: "ABERTA", pag: [{ forma: "DINHEIRO", v: 3000, por: rec.id }, { forma: "PIX", v: 3000, status: "AGUARDANDO", gatewayPedidoId: `sim_${Date.now()}`, por: rec.id }] });
    ok((await falha(() => cancelarPagamento(sr, c8.pagamentos[0].id)))?.codigo === "pedir_estorno", "recepção não desfaz pagamento PAGO: vira pedido de estorno");
    await cancelarPagamento(sr, c8.pagamentos[1].id);
    ok((await db.pagamentoComanda.findUniqueOrThrow({ where: { id: c8.pagamentos[1].id } })).status === "CANCELADO", "pagamento AGUARDANDO na maquininha: quem lançou ainda cancela");
    const lista = await listarEstornos(sr);
    ok(!lista.dono && lista.historico.some((e) => e.id === p1.id && e.pedidoPor === rec.nome && e.decididoPor === dono.nome), "lista mostra quem pediu e quem decidiu");

    // ---- 9) financeiro desconta (sem contar em dobro)
    const efetivos = 4500 + 1000 + 3321 + 4321 + 7000 + 8000 + 2000;
    const [res, conc] = await Promise.all([resumoMes(hoje.slice(0, 7)), conciliacao(hoje, hoje)]);
    const est = res.receitas.estornos;
    ok(est.total - resAntes.receitas.estornos.total === efetivos, `resumo do mês desconta os estornos (${est.total - resAntes.receitas.estornos.total})`);
    const rr = res.receitas;
    ok(rr.total === rr.comandas.total + rr.antecipados.total + rr.mensalidades.total + rr.links.total - est.total, "receita total = recebido - estornos");
    ok(rr.links.total - resAntes.receitas.links.total === 4500 + 2000, "link estornado continua como recebido na data do pagamento (o estorno desconta à parte)");
    ok(online(conc) - online(concAntes) === 4500 + 1000 + 3321 + 7000 + 2000, "conciliação: estornos online descontados no dia");
    const cred = conc.linhas.find((l) => l.forma === "CREDITO");
    ok((cred?.estornoCentavos ?? 0) >= 8000 && !conc.linhas.some((l) => (l.forma as string) === "DINHEIRO"), "conciliação: estorno da maquininha no crédito; dinheiro fica no caixa");
    const ext = await extratoCaixa(caixaTeste);
    const linhasEst = ext.linhas.filter((l) => l.tipo === "ESTORNO");
    ok(linhasEst.some((l) => l.dinheiro && l.valorCentavos === 4321) && !ext.linhas.some((l) => l.tipo === "SANGRIA" && l.valorCentavos === 4321), "extrato: estorno em dinheiro aparece como ESTORNO (não duplica a sangria)");
    ok(linhasEst.some((l) => !l.dinheiro) && ext.saldoDinheiro === (await resumoCaixa((await caixaAberto())!)).esperado, "extrato: estornos de outros meios aparecem sem mexer na gaveta; saldo bate com o esperado");
  } finally {
    if (caixaTeste) await db.caixa.deleteMany({ where: { id: caixaTeste } });
    if (jaAberto) await db.caixa.update({ where: { id: jaAberto.id }, data: { status: "ABERTO", fechadoEm: null, observacao: null } });
    await limpar();
  }
  console.log(process.exitCode ? "\nAlgum teste FALHOU." : "\nTodos os testes passaram.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
