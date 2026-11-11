// Teste de integracao de estoque + comanda + maquininha Stone (Connect 2.0) contra o banco de
// local descartável dedicado, com uma Pagar.me FALSA em memória. Cria e apaga os próprios dados.
// Rodar pelo coordenador local com AMBIENTE=teste: npm run teste:comandas
process.env.MAQUININHA = "stone";
process.env.STONE_POS_SERIAL = "SERIAL123";
process.env.PAGARME_SECRET_KEY = "sk_test_falsa";
process.env.STONE_POS_SERVICE_REFERER_NAME = "parceiro-ficticio";
process.env.STONE_POS_SPLIT_JSON = '[{"amount":100,"recipient_id":"rp_ficticio","type":"percentage","options":{"liable":true,"charge_processing_fee":true,"charge_remainder_fee":true}}]';

import type { Sessao } from "@/lib/auth/sessao";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { ErroNegocio } from "@/lib/erros";
import { _usarFetch } from "@/lib/pagamentos/pagarme";
import { lancarMovimento } from "@/lib/comandas/estoque";
import { cancelarPagamento, registrarPagamento, sincronizarPedido } from "@/lib/comandas/maquininha";
import { alterarStatus } from "@/lib/agenda/agendamentos";
import { adicionarServico } from "@/lib/comandas/adicional";
import { configuracao } from "@/lib/agenda/carregar";
import { instanteLocal } from "@/lib/agenda/tempo";
import { abrirComanda, adicionarProduto, alterarItem, cancelarComanda, detalheComanda, fecharComanda } from "@/lib/comandas/servico";

const destino = new URL(process.env.DATABASE_URL ?? "http://invalido");
const bancoDedicado = destino.port === "55439" && destino.username === "auditoria_teste"
  && /^\/barberos_ci_local_regr_comandas_\d{8}$/.test(destino.pathname);
const bancoDaRevisao = destino.port === "55561" && destino.username === "avisos_teste"
  && destino.pathname === "/barberos_stone_revisao_20261111";
if (!["postgres:", "postgresql:"].includes(destino.protocol) || destino.hostname !== "127.0.0.1"
  || (!bancoDedicado && !bancoDaRevisao)) {
  throw new Error("Comandas restrito aos bancos descartáveis locais autorizados para a revisão.");
}

const ok = (c: boolean, msg: string) => { if (!c) throw new Error(`FALHOU ${msg}`); console.log(`OK  ${msg}`); };
const falha = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e) { return e as Error; } };
const pos = (forma: "CREDITO" | "DEBITO" | "PIX", valorCentavos: number) =>
  ({ forma, valorCentavos, naMaquininha: true, solicitacaoId: randomUUID() });

// ---- Pagar.me falsa (so as rotas do Connect)
type Pedido = { id: string; code: string; status: string; amount: number; currency: string; metadata: Record<string, string>;
  corpo: Record<string, unknown>; charges: { id: string; code: string; status: string; amount: number; paid_amount: number; currency: string; metadata: Record<string, string> }[] };
const pedidos = new Map<string, Pedido>();
const fechados: { id: string; status: string }[] = [];
let recusarProximo = false;
let perderResposta = false;
let seq = 0;
_usarFetch((async (url: string, init?: RequestInit) => {
  const caminho = new URL(url).pathname.replace("/core/v5", "");
  const corpo = init?.body ? JSON.parse(String(init.body)) : {};
  const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status });
  if (init?.method === "POST" && caminho === "/orders") {
    if (recusarProximo) { recusarProximo = false; return json({ message: "Device not found" }, 422); }
    const p: Pedido = { id: `or_${++seq}`, code: corpo.code, status: "pending", amount: corpo.items[0].amount,
      currency: "BRL", metadata: corpo.metadata, corpo, charges: [] };
    pedidos.set(p.id, p);
    if (perderResposta) { perderResposta = false; throw new TypeError("Conexão caiu após aceitar pedido"); }
    return json(p);
  }
  let m = caminho.match(/^\/orders\/([^/]+)\/closed$/);
  if (m && init?.method === "PATCH") {
    fechados.push({ id: m[1], status: corpo.status });
    const p = pedidos.get(m[1]); if (p) p.status = corpo.status;
    return json({});
  }
  m = caminho.match(/^\/orders\/([^/]+)$/);
  if (m && pedidos.has(m[1])) return json(pedidos.get(m[1]));
  return json({ message: `rota falsa nao implementada: ${init?.method} ${caminho}` }, 404);
}) as typeof fetch);

const TEL = "5511933337001";
const TEL_AGENDA = "5511933337002";
async function limpar() {
  const c = await db.cliente.findUnique({ where: { telefone: TEL } });
  const ps = await db.produto.findMany({ where: { nome: { startsWith: "[teste] " } }, select: { id: true } });
  if (c) {
    const cs = await db.comanda.findMany({ where: { clienteId: c.id }, select: { id: true } });
    await db.pedidoEstorno.deleteMany({ where: { comandaId: { in: cs.map((x) => x.id) } } });
    await db.linkPagamento.deleteMany({ where: { comandaId: { in: cs.map((x) => x.id) } } });
    await db.itemComanda.deleteMany({ where: { comandaId: { in: cs.map((x) => x.id) } } });
    await db.comanda.deleteMany({ where: { id: { in: cs.map((x) => x.id) } } });
    await db.agendamento.deleteMany({ where: { clienteId: c.id } });
    await db.cliente.delete({ where: { id: c.id } });
  }
  const proximo = await db.cliente.findUnique({ where: { telefone: TEL_AGENDA } });
  if (proximo) {
    await db.agendamento.deleteMany({ where: { clienteId: proximo.id } });
    await db.cliente.delete({ where: { id: proximo.id } });
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
  const e2 = await falha(() => registrarPagamento(s, id, pos("CREDITO", d.resumo.total + 100)));
  ok(!!e2 && /maior/.test(e2.message), "cartão acima do que falta é recusado");
  await registrarPagamento(s, id, { forma: "DINHEIRO", valorCentavos: 5000, naMaquininha: false });

  recusarProximo = true;
  const e3 = await falha(() => registrarPagamento(s, id, pos("DEBITO", 1000)));
  d = await detalheComanda(id);
  ok(!!e3 && /maquininha/.test(e3.message) && d.pagamentos.some((p) => p.forma === "DEBITO" && p.status === "CANCELADO"), "maquininha recusou o pedido: pagamento desfeito com aviso");

  const falta = d.resumo.falta;
  const sessaoBarbeiro: Sessao = { ...s, papel: "BARBEIRO", usuarioId: barbeiro.usuarioId, barbeiroId: barbeiro.id, nome: barbeiro.nome };
  const outroBarbeiro = await db.barbeiro.findFirstOrThrow({ where: { id: { not: barbeiro.id }, ativo: true } });
  const comandaAlheia = await falha(() => registrarPagamento({ ...sessaoBarbeiro, usuarioId: outroBarbeiro.usuarioId, barbeiroId: outroBarbeiro.id }, id, pos("DEBITO", falta)));
  ok(comandaAlheia instanceof ErroNegocio && comandaAlheia.status === 403, "barbeiro de outra agenda não envia pedido POS");
  const pg = await registrarPagamento(sessaoBarbeiro, id, pos("CREDITO", falta));
  ok(pg.registradoPorId === barbeiro.usuarioId, "comanda com serviço próprio e produtos sem profissional permite POS no app do barbeiro");
  const pedido = pedidos.get(pg.gatewayPedidoId!)!;
  const poi = pedido.corpo.poi_payment_settings as { devices_serial_number: string[]; payment_setup: { type: string } };
  ok(pg.status === "AGUARDANDO" && poi.devices_serial_number[0] === "SERIAL123" && poi.payment_setup.type === "credit" && pedido.corpo.closed === false,
    "pedido direto criado na maquininha certa, crédito, aberto");
  const e4 = await falha(() => fecharComanda(s, id));
  ok(!!e4 && /maquininha/.test(e4.message), "não fecha com pagamento esperando a maquininha");

  // cliente passa o cartao -> webhook -> sincroniza
  pedido.status = "paid";
  pedido.charges = [{ id: "ch_1", code: "NSU987", status: "paid", amount: pedido.amount, paid_amount: pedido.amount,
    currency: "BRL", metadata: { schemeName: "Mastercard" } }];
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
  const pg2 = await registrarPagamento(s, outra.id, pos("PIX", 1200));
  await cancelarPagamento(s, pg2.id);
  ok(fechados.some((f) => f.id === pg2.gatewayPedidoId && f.status === "canceled"), "desistiu: pedido cancelado na maquininha");
  await cancelarComanda(s, outra.id, "teste");

  // ---- devolução externa: concilia pagamento E ledger financeiro uma única vez.
  const devolucao = await abrirComanda(s, { clienteId: cliente.id });
  await adicionarProduto(s, devolucao.id, cerveja.id, 1);
  const pg3 = await registrarPagamento(s, devolucao.id, pos("CREDITO", 1200));
  const pedido3 = pedidos.get(pg3.gatewayPedidoId!)!;
  pedido3.charges = [{ id: "ch_devolucao", code: "NSU3", status: "paid", amount: 1200, paid_amount: 1200,
    currency: "BRL", metadata: { schemeName: "Visa" } }];
  await sincronizarPedido(pedido3.id);
  await db.pedidoEstorno.create({ data: { tipo: "COMANDA", referenciaId: pg3.id, valorCentavos: 1200, valorOriginalCentavos: 1200,
    motivo: "Teste devolução externa", status: "APROVADO", meio: "MAQUININHA", forma: "CREDITO", descricao: "Teste POS", comandaId: devolucao.id } });
  Object.assign(pedido3.charges[0], { status: "canceled", canceled_amount: 1200 });
  await sincronizarPedido(pedido3.id); await sincronizarPedido(pedido3.id);
  const estornos = await db.pedidoEstorno.findMany({ where: { referenciaId: pg3.id } });
  const pgDevolvido = await db.pagamentoComanda.findUniqueOrThrow({ where: { id: pg3.id } });
  ok(estornos.length === 1 && estornos[0].status === "EXECUTADO" && estornos[0].valorCentavos === 1200,
    "devolução no POS concilia o pedido aprovado no ledger financeiro sem duplicar");
  ok(pgDevolvido.status === "CANCELADO" && pgDevolvido.estornadoCentavos === 1200,
    "pagamento e ledger concordam após webhook de devolução repetido");
  await cancelarComanda(s, devolucao.id, "teste");

  // ---- cancelar comanda fechada devolve estoque
  await cancelarComanda(s, id, "lançou errado");
  const cv2 = await db.produto.findUniqueOrThrow({ where: { id: cerveja.id } });
  ok(cv2.estoque === 9, "cancelar comanda fechada devolve os produtos ao estoque");
  const movs = await db.movimentoEstoque.findMany({ where: { produtoId: cerveja.id }, orderBy: { criadoEm: "asc" } });
  ok(movs.map((m) => m.tipo).join(",") === "ENTRADA,AJUSTE,VENDA,ESTORNO" && movs.at(-1)!.saldoApos === 9, "histórico completo com saldo após cada movimento");

  // ---- intenção de link incerta continua reservando, mesmo após expiração.
  const concorrencia = await abrirComanda(s, { clienteId: cliente.id });
  await adicionarProduto(s, concorrencia.id, cerveja.id, 2);
  const linkIncerto = await db.linkPagamento.create({ data: {
    token: `teste-pos-${concorrencia.id}`, descricao: "Teste link incerto", nome: "Teste", telefone: TEL,
    comandaId: concorrencia.id, valorCentavos: 1200, expiraEm: new Date(Date.now() - 60_000), tentativaChave: `teste-pos-${concorrencia.id}`,
  } });
  const pedidoAntes = seq;
  const erroLink = await falha(() => registrarPagamento(s, concorrencia.id, pos("DEBITO", 1200)));
  ok(erroLink instanceof ErroNegocio && erroLink.codigo === "link_pendente" && seq === pedidoAntes,
    "link vencido com resultado incerto bloqueia POS sem enviar outro pedido");
  await db.linkPagamento.update({ where: { id: linkIncerto.id }, data: { status: "CANCELADO" } });
  const metade = pos("DEBITO", 1200);
  const enviar = () => registrarPagamento(s, concorrencia.id, metade);
  const [primeiro, repetido] = await Promise.all([enviar(), enviar()]);
  ok(primeiro.id === repetido.id && seq === pedidoAntes + 1,
    "duas solicitações concorrentes criam uma intenção e um pedido POS");
  const pedidoParcial = pedidos.get(`or_${seq}`)!;
  pedidoParcial.charges = [{ id: "ch_parcial", code: "NSUP", status: "paid", amount: 1200, paid_amount: 1200, currency: "BRL", metadata: {} }];
  await sincronizarPedido(pedidoParcial.id);
  const retomado = await enviar();
  ok(retomado.id === primeiro.id && retomado.status === "PAGO" && seq === pedidoAntes + 1
    && (await detalheComanda(concorrencia.id)).resumo.falta === 1200,
  "repetição depois do pagamento parcial confirma o registro existente e preserva o saldo restante");
  const restante = await registrarPagamento(s, concorrencia.id, pos("DEBITO", 1200));
  ok(restante.id !== primeiro.id && seq === pedidoAntes + 2, "nova solicitação pode receber o saldo restante");
  await cancelarPagamento(s, restante.id);
  pedidoParcial.charges[0] = { ...pedidoParcial.charges[0], status: "canceled", canceled_amount: 1200 } as typeof pedidoParcial.charges[number];
  await sincronizarPedido(pedidoParcial.id);
  await cancelarComanda(s, concorrencia.id, "teste");

  // ---- POST aceito sem resposta: não duplica; recupera somente pelo retorno autoritativo.
  const incerta = await abrirComanda(s, { clienteId: cliente.id }); await adicionarProduto(s, incerta.id, cerveja.id, 1);
  perderResposta = true;
  const dadosIncerta = pos("PIX", 1200);
  const erroIncerto = await falha(() => registrarPagamento(s, incerta.id, dadosIncerta));
  ok(erroIncerto instanceof ErroNegocio && erroIncerto.codigo === "maquininha_incerta", "POST sem resposta é tratado como incerto");
  const atual = await db.pagamentoComanda.findFirstOrThrow({ where: { comandaId: incerta.id } });
  const seqIncerta = seq; const novamente = await registrarPagamento(s, incerta.id, dadosIncerta);
  ok(atual.status === "AGUARDANDO" && !atual.gatewayPedidoId && novamente.id === atual.id && seq === seqIncerta,
    "resultado incerto reserva valor e não reenvia cobrança");
  const pedidoIncerto = pedidos.get(`or_${seqIncerta}`)!;
  pedidoIncerto.charges = [{ id: "ch_incerta", code: "NSUI", status: "paid", amount: 1200, paid_amount: 1200, currency: "BRL", metadata: {} }];
  await sincronizarPedido(pedidoIncerto.id);
  const recuperado = await db.pagamentoComanda.findUniqueOrThrow({ where: { id: atual.id } });
  ok(recuperado.status === "PAGO" && recuperado.gatewayPedidoId === pedidoIncerto.id,
    "webhook consulta API e recupera vínculo perdido com identidade e valor exatos");
  await fecharComanda(s, incerta.id);
  await cancelarComanda(s, incerta.id, "teste");

  // ---- adicional da recepção tem reserva própria, nunca sobrepõe o próximo cliente.
  const extra = await db.barbeiroServico.findFirstOrThrow({ where: { barbeiroId: barbeiro.id, servico: { ativo: true } }, include: { servico: true } });
  const { fuso } = await configuracao();
  const inicio2 = new Date(instanteLocal("2031-01-08", 9 * 60 + 5, fuso)); // Quarta, dentro da manhã do seed.
  const ag2 = await db.agendamento.create({
    data: { barbeiroId: barbeiro.id, clienteId: cliente.id, servicoId: servico.id, inicio: inicio2, fim: new Date(+inicio2 + 30 * 60_000), origem: "RECEPCAO", precoCentavos: 5000, status: "EM_ATENDIMENTO" },
  });
  const cm = await abrirComanda(s, { agendamentoId: ag2.id });
  const proximoCliente = await db.cliente.create({ data: { telefone: TEL_AGENDA, nome: "Próximo cliente fictício" } });
  const proximo = await db.agendamento.create({
    data: { barbeiroId: barbeiro.id, clienteId: proximoCliente.id, servicoId: servico.id, inicio: ag2.fim, fim: new Date(+ag2.fim + 30 * 60_000), origem: "RECEPCAO", precoCentavos: 5000, status: "MARCADO" },
  });
  const solicitacaoId = randomUUID();
  const conflito = await falha(() => adicionarServico(s, cm.id, extra.servicoId, barbeiro.id, solicitacaoId));
  ok(conflito instanceof ErroNegocio && conflito.codigo === "conflito_horario", "próximo cliente impede adicional no mesmo período, sem alterar a reserva existente");
  ok(await db.agendamento.count({ where: { adicionalDeId: ag2.id } }) === 0, "tentativa em conflito não deixa adicional nem cobrança parcial");
  await alterarStatus(proximo.id, "CANCELADO", s);
  const [adic, repetida] = await Promise.all([
    adicionarServico(s, cm.id, extra.servicoId, barbeiro.id, solicitacaoId),
    adicionarServico(s, cm.id, extra.servicoId, barbeiro.id, solicitacaoId),
  ]);
  const precoExtra = extra.precoCentavos ?? extra.servico.precoCentavos;
  ok(adic.adicionalDeId === ag2.id && adic.status === "MARCADO" && adic.ocupaAgenda && +adic.inicio === +ag2.fim && adic.precoCentavos === precoExtra,
    "adicional reserva seu horário, inicia marcado e usa o preço do profissional");
  ok(adic.id === solicitacaoId && repetida.id === adic.id && await db.itemComanda.count({ where: { agendamentoId: adic.id } }) === 1,
    "repetição concorrente da mesma solicitação produz um adicional e um item");
  let dc = await detalheComanda(cm.id);
  ok(dc.itens.some((i) => i.agendamentoId === adic.id && i.precoUnitCentavos === precoExtra && i.barbeiroId === barbeiro.id), "adicional preserva o vínculo do profissional sem antecipar serviço concluído");
  ok(dc.resumo.total === 5000 + precoExtra, "total soma o serviço adicional");
  await alterarStatus(ag2.id, "CONCLUIDO", s);
  ok((await db.agendamento.findUniqueOrThrow({ where: { id: adic.id } })).status === "MARCADO", "concluir o principal não conclui adicional ainda não realizado");
  const fechamentoPendente = await falha(() => fecharComanda(s, cm.id));
  ok(fechamentoPendente instanceof ErroNegocio && fechamentoPendente.codigo === "adicional_pendente", "fechamento exige conclusão individual ou remoção do adicional pendente");
  await alterarStatus(adic.id, "CONCLUIDO", s);
  ok((await db.agendamento.findUniqueOrThrow({ where: { id: adic.id } })).status === "CONCLUIDO", "adicional só fica concluído após sua própria baixa operacional");
  const remocaoConcluida = await falha(() => alterarItem(s, dc.itens.find(i => i.agendamentoId === adic.id)!.id, 0));
  ok(remocaoConcluida instanceof ErroNegocio && remocaoConcluida.codigo === "adicional_iniciado", "serviço concluído não é removido para apagar histórico");
  const semCliente = await abrirComanda(s, { nomeAvulso: "Balcão" });
  ok((await falha(() => adicionarServico(s, semCliente.id, extra.servicoId, barbeiro.id)))?.message.includes("avulso") === true, "comanda sem cliente pede item avulso");
  await cancelarComanda(s, semCliente.id, "teste");
  const removivelId = randomUUID();
  const removivel = await adicionarServico(s, cm.id, extra.servicoId, barbeiro.id, removivelId);
  dc = await detalheComanda(cm.id);
  await alterarItem(s, dc.itens.find((i) => i.agendamentoId === removivel.id)!.id, 0);
  ok((await db.agendamento.findUniqueOrThrow({ where: { id: removivel.id } })).status === "CANCELADO", "remover adicional ainda marcado cancela sua reserva");
  const repetirRemovido = await falha(() => adicionarServico(s, cm.id, extra.servicoId, barbeiro.id, removivelId));
  ok(repetirRemovido instanceof ErroNegocio && repetirRemovido.codigo === "solicitacao_encerrada", "repetir solicitação removida não ressuscita reserva nem cobrança");
  dc = await detalheComanda(cm.id);
  ok(dc.resumo.total === 5000 + precoExtra, "remoção do pendente preserva o principal e o adicional realizado");
  const pendente = await adicionarServico(s, cm.id, extra.servicoId, barbeiro.id, randomUUID());
  await cancelarComanda(s, cm.id, "teste");
  await alterarStatus(ag2.id, "CONFIRMADO", s);
  ok((await db.agendamento.findUniqueOrThrow({ where: { id: pendente.id } })).status === "CANCELADO"
    && (await db.agendamento.findUniqueOrThrow({ where: { id: adic.id } })).status === "CONCLUIDO",
  "cancelar comanda libera pendente, preserva realizado e reconfirmar principal não reativa adicional");

  await limpar();
  await db.$disconnect();
}
main().catch(async (e) => { console.error(e); await limpar().catch(() => {}); process.exit(1); });
