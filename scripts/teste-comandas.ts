// Teste de integracao de estoque + comanda + maquininha Stone (Connect 2.0) contra o banco de
// DESENVOLVIMENTO, com uma Pagar.me FALSA em memoria. Cria e apaga os proprios dados.
// Rodar: npm run teste:comandas
process.env.MAQUININHA = "stone";
process.env.STONE_POS_SERIAL = "SERIAL123";
process.env.PAGARME_SECRET_KEY = "sk_test_falsa";

import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio } from "@/lib/erros";
import { _usarFetch } from "@/lib/pagamentos/pagarme";
import { lancarMovimento } from "@/lib/comandas/estoque";
import { cancelarPagamento, registrarPagamento, sincronizarPedido } from "@/lib/comandas/maquininha";
import { alterarStatus } from "@/lib/agenda/agendamentos";
import { adicionarServico } from "@/lib/comandas/adicional";
import { abrirComanda, adicionarProduto, alterarItem, cancelarComanda, detalheComanda, fecharComanda } from "@/lib/comandas/servico";

const ok = (c: boolean, msg: string) => console.log(`${c ? "OK  " : "FALHOU"} ${msg}`);
const falha = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e) { return e as Error; } };

// ---- Pagar.me falsa (so as rotas do Connect)
type Pedido = { id: string; code: string; status: string; corpo: Record<string, unknown>; charges: { id: string; code: string; status: string; metadata: Record<string, string> }[] };
const pedidos = new Map<string, Pedido>();
const fechados: { id: string; status: string }[] = [];
let recusarProximo = false;
let seq = 0;
_usarFetch((async (url: string, init?: RequestInit) => {
  const caminho = new URL(url).pathname.replace("/core/v5", "");
  const corpo = init?.body ? JSON.parse(String(init.body)) : {};
  const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status });
  if (init?.method === "POST" && caminho === "/orders") {
    if (recusarProximo) { recusarProximo = false; return json({ message: "Device not found" }, 422); }
    const p: Pedido = { id: `or_${++seq}`, code: corpo.code, status: "pending", corpo, charges: [] };
    pedidos.set(p.id, p);
    return json(p);
  }
  let m = caminho.match(/^\/orders\/([^/]+)\/closed$/);
  if (m && init?.method === "PATCH") { fechados.push({ id: m[1], status: corpo.status }); return json({}); }
  m = caminho.match(/^\/orders\/([^/]+)$/);
  if (m && pedidos.has(m[1])) return json(pedidos.get(m[1]));
  return json({ message: `rota falsa nao implementada: ${init?.method} ${caminho}` }, 404);
}) as typeof fetch);

const TEL = "5511933337001";
async function limpar() {
  const c = await db.cliente.findUnique({ where: { telefone: TEL } });
  const ps = await db.produto.findMany({ where: { nome: { startsWith: "[teste] " } }, select: { id: true } });
  if (c) {
    const cs = await db.comanda.findMany({ where: { clienteId: c.id }, select: { id: true } });
    await db.itemComanda.deleteMany({ where: { comandaId: { in: cs.map((x) => x.id) } } });
    await db.comanda.deleteMany({ where: { id: { in: cs.map((x) => x.id) } } });
    await db.agendamento.deleteMany({ where: { clienteId: c.id } });
    await db.cliente.delete({ where: { id: c.id } });
  }
  await db.movimentoEstoque.deleteMany({ where: { produtoId: { in: ps.map((p) => p.id) } } });
  await db.itemComanda.deleteMany({ where: { produtoId: { in: ps.map((p) => p.id) } } });
  await db.produto.deleteMany({ where: { id: { in: ps.map((p) => p.id) } } });
}

async function main() {
  await limpar();
  const dono = await db.usuario.findFirstOrThrow({ where: { papel: "DONO" } });
  const s: Sessao = { usuarioId: dono.id, papel: "DONO", nome: dono.nome, barbeiroId: null, clienteId: null };

  // ---- estoque
  const cerveja = await db.produto.create({ data: { nome: "[teste] Cerveja", categoria: "BAR", precoCentavos: 1200, estoqueMinimo: 3 } });
  const pomada = await db.produto.create({ data: { nome: "[teste] Pomada", categoria: "LOJA", precoCentavos: 4500 } });
  const lamina = await db.produto.create({ data: { nome: "[teste] Lamina", categoria: "USO_INTERNO" } });
  await lancarMovimento(s.usuarioId, { produtoId: cerveja.id, tipo: "ENTRADA", quantidade: 10, custoUnitarioCentavos: 550 });
  await lancarMovimento(s.usuarioId, { produtoId: pomada.id, tipo: "ENTRADA", quantidade: 2 });
  let c1 = await db.produto.findUniqueOrThrow({ where: { id: cerveja.id } });
  ok(c1.estoque === 10 && c1.custoCentavos === 550, "entrada soma o saldo e atualiza o custo");
  await lancarMovimento(s.usuarioId, { produtoId: cerveja.id, tipo: "AJUSTE", quantidade: 9, motivo: "contagem" });
  c1 = await db.produto.findUniqueOrThrow({ where: { id: cerveja.id } });
  ok(c1.estoque === 9, "ajuste de contagem lança só a diferença (-1)");

  // ---- comanda vinda da agenda (o servico entra sozinho)
  const cliente = await db.cliente.create({ data: { telefone: TEL, nome: "Comanda Teste" } });
  const barbeiro = await db.barbeiro.findFirstOrThrow({ where: { ativo: true } });
  const servico = await db.servico.findFirstOrThrow({ where: { ativo: true } });
  const inicio = new Date(Date.UTC(2031, 0, 7, 12, (Date.now() % 40) + 5));
  const ag = await db.agendamento.create({
    data: { barbeiroId: barbeiro.id, clienteId: cliente.id, servicoId: servico.id, inicio, fim: new Date(+inicio + 30 * 60_000), origem: "RECEPCAO", precoCentavos: 5000, status: "CONCLUIDO" },
  });
  const { id } = await abrirComanda(s, { agendamentoId: ag.id });
  const denovo = await abrirComanda(s, { agendamentoId: ag.id });
  ok(denovo.id === id && !denovo.nova, "abrir de novo pelo mesmo atendimento volta na mesma comanda");

  await adicionarProduto(s, id, cerveja.id, 2);
  await adicionarProduto(s, id, cerveja.id, 1);
  await adicionarProduto(s, id, pomada.id, 3);
  const e1 = await falha(() => adicionarProduto(s, id, lamina.id, 1));
  ok(e1 instanceof ErroNegocio, "produto de uso interno não entra na comanda");
  let d = await detalheComanda(id);
  ok(d.itens.length === 3 && d.itens.find((i) => i.produtoId === cerveja.id)?.quantidade === 3, "mesmo produto soma na mesma linha");
  ok(d.resumo.total === 5000 + 3 * 1200 + 3 * 4500, `total ${d.resumo.total} = serviço + 3 cervejas + 3 pomadas`);

  // ---- pagamentos: parte em dinheiro, parte na maquininha
  const e2 = await falha(() => registrarPagamento(s, id, { forma: "CREDITO", valorCentavos: d.resumo.total + 100, naMaquininha: true }));
  ok(!!e2 && /maior/.test(e2.message), "cartão acima do que falta é recusado");
  await registrarPagamento(s, id, { forma: "DINHEIRO", valorCentavos: 5000, naMaquininha: false });

  recusarProximo = true;
  const e3 = await falha(() => registrarPagamento(s, id, { forma: "DEBITO", valorCentavos: 1000, naMaquininha: true }));
  d = await detalheComanda(id);
  ok(!!e3 && /maquininha/.test(e3.message) && d.pagamentos.some((p) => p.forma === "DEBITO" && p.status === "CANCELADO"), "maquininha recusou o pedido: pagamento desfeito com aviso");

  const falta = d.resumo.falta;
  const pg = await registrarPagamento(s, id, { forma: "CREDITO", valorCentavos: falta, naMaquininha: true });
  const pedido = pedidos.get(pg.gatewayPedidoId!)!;
  const poi = pedido.corpo.poi_payment_settings as { devices_serial_number: string[]; payment_setup: { type: string } };
  ok(pg.status === "AGUARDANDO" && poi.devices_serial_number[0] === "SERIAL123" && poi.payment_setup.type === "credit" && pedido.corpo.closed === false,
    "pedido direto criado na maquininha certa, crédito, aberto");
  const e4 = await falha(() => fecharComanda(s, id));
  ok(!!e4 && /maquininha/.test(e4.message), "não fecha com pagamento esperando a maquininha");

  // cliente passa o cartao -> webhook -> sincroniza
  pedido.status = "paid";
  pedido.charges = [{ id: "ch_1", code: "NSU987", status: "paid", metadata: { schemeName: "Mastercard" } }];
  ok(await sincronizarPedido(pedido.id), "webhook reconhece o pedido da comanda");
  await sincronizarPedido(pedido.id); // webhook repetido
  d = await detalheComanda(id);
  const aprovado = d.pagamentos.find((p) => p.id === pg.id)!;
  ok(aprovado.status === "PAGO" && aprovado.nsu === "NSU987" && aprovado.bandeira === "Mastercard", "aprovado com NSU e bandeira");
  ok(fechados.filter((f) => f.id === pedido.id && f.status === "paid").length >= 1, "pedido fechado na Pagar.me (sai da fila da maquininha)");
  ok(d.resumo.podeFechar && d.resumo.falta === 0, "comanda paga");

  // ---- fechar baixa estoque
  const r = await fecharComanda(s, id);
  const [cv, pm] = await Promise.all([db.produto.findUniqueOrThrow({ where: { id: cerveja.id } }), db.produto.findUniqueOrThrow({ where: { id: pomada.id } })]);
  ok(cv.estoque === 6 && pm.estoque === -1, `estoque baixado (cerveja ${cv.estoque}, pomada ${pm.estoque})`);
  ok(r.alertas.some((a) => a.includes("Pomada")), "avisa estoque negativo");
  const e5 = await falha(() => adicionarProduto(s, id, cerveja.id, 1));
  ok(e5 instanceof ErroNegocio, "comanda fechada não aceita item");

  // ---- cancelar pagamento aguardando tira da maquininha
  const outra = await abrirComanda(s, { clienteId: cliente.id });
  await adicionarProduto(s, outra.id, cerveja.id, 1);
  const pg2 = await registrarPagamento(s, outra.id, { forma: "PIX", valorCentavos: 1200, naMaquininha: true });
  await cancelarPagamento(s, pg2.id);
  ok(fechados.some((f) => f.id === pg2.gatewayPedidoId && f.status === "canceled"), "desistiu: pedido cancelado na maquininha");
  await cancelarComanda(s, outra.id, "teste");

  // ---- cancelar comanda fechada devolve estoque
  await cancelarComanda(s, id, "lançou errado");
  const cv2 = await db.produto.findUniqueOrThrow({ where: { id: cerveja.id } });
  ok(cv2.estoque === 9, "cancelar comanda fechada devolve os produtos ao estoque");
  const movs = await db.movimentoEstoque.findMany({ where: { produtoId: cerveja.id }, orderBy: { criadoEm: "asc" } });
  ok(movs.map((m) => m.tipo).join(",") === "ENTRADA,AJUSTE,VENDA,ESTORNO" && movs.at(-1)!.saldoApos === 9, "histórico completo com saldo após cada movimento");

  // ---- servico adicional (ex.: sobrancelha junto do corte)
  const extra = await db.barbeiroServico.findFirstOrThrow({ where: { barbeiroId: barbeiro.id, servico: { ativo: true } }, include: { servico: true } });
  const inicio2 = new Date(Date.UTC(2031, 0, 8, 12, (Date.now() % 40) + 5));
  const ag2 = await db.agendamento.create({
    data: { barbeiroId: barbeiro.id, clienteId: cliente.id, servicoId: servico.id, inicio: inicio2, fim: new Date(+inicio2 + 30 * 60_000), origem: "RECEPCAO", precoCentavos: 5000, status: "EM_ATENDIMENTO" },
  });
  const cm = await abrirComanda(s, { agendamentoId: ag2.id });
  // Proximo cliente do barbeiro logo depois: o adicional nao pode travar por "horario ocupado".
  await db.agendamento.create({
    data: { barbeiroId: barbeiro.id, clienteId: cliente.id, servicoId: servico.id, inicio: ag2.fim, fim: new Date(+ag2.fim + 30 * 60_000), origem: "RECEPCAO", precoCentavos: 5000, status: "MARCADO" },
  });
  const adic = await adicionarServico(s, cm.id, extra.servicoId, barbeiro.id);
  const precoExtra = extra.precoCentavos ?? extra.servico.precoCentavos;
  ok(adic.adicionalDeId === ag2.id && adic.status === "EM_ATENDIMENTO" && adic.precoCentavos === precoExtra, "adicional ligado ao atendimento, mesmo status, preço do barbeiro");
  let dc = await detalheComanda(cm.id);
  ok(dc.itens.some((i) => i.agendamentoId === adic.id && i.precoUnitCentavos === precoExtra && i.barbeiroId === barbeiro.id), "adicional entra na comanda com o barbeiro (comissão)");
  ok(dc.resumo.total === 5000 + precoExtra, "total soma o serviço adicional");
  await alterarStatus(ag2.id, "CONCLUIDO", s);
  ok((await db.agendamento.findUniqueOrThrow({ where: { id: adic.id } })).status === "CONCLUIDO", "concluir o atendimento conclui o adicional junto");
  const semCliente = await abrirComanda(s, { nomeAvulso: "Balcão" });
  ok((await falha(() => adicionarServico(s, semCliente.id, extra.servicoId, barbeiro.id)))?.message.includes("avulso") === true, "comanda sem cliente pede item avulso");
  await cancelarComanda(s, semCliente.id, "teste");
  await alterarItem(s, dc.itens.find((i) => i.agendamentoId === adic.id)!.id, 0);
  ok((await db.agendamento.findUniqueOrThrow({ where: { id: adic.id } })).status === "CANCELADO", "tirar o adicional da comanda cancela o atendimento adicional");
  dc = await detalheComanda(cm.id);
  ok(dc.resumo.total === 5000, "total volta ao valor do corte");
  await cancelarComanda(s, cm.id, "teste");

  await limpar();
  await db.$disconnect();
}
main().catch(async (e) => { console.error(e); await limpar().catch(() => {}); process.exit(1); });
