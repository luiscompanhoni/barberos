import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { criarLink } from "@/lib/links/servico";
import { registrarPagamento } from "@/lib/comandas/maquininha";
import { detalheComanda } from "@/lib/comandas/servico";

const url = new URL(process.env.DATABASE_URL ?? "http://invalido");
if (url.hostname !== "127.0.0.1" || url.port !== "15439" || !/^\/barberos_pagamentos_teste(?:_\d+)?$/.test(url.pathname)) {
  throw Error("Use exclusivamente o banco sintético barberos_pagamentos_teste em 127.0.0.1:15439.");
}
if (process.env.PAGAMENTOS_PROVIDER !== "simulado" || process.env.WHATSAPP_PROVIDER !== "simulador") throw Error("Provedores externos devem estar simulados.");
process.env.MAQUININHA = "simulada";
let rede = 0;
globalThis.fetch = async () => { rede++; throw Error("Rede externa proibida neste teste."); };

async function main() {
  const dono = await db.usuario.create({ data: { nome: "Dono sintético links", telefone: `teste-links-${Date.now()}`, papel: "DONO" } });
  const sessao = { usuarioId: dono.id, papel: "DONO" as const, nome: dono.nome, barbeiroId: null, clienteId: null };
  const comanda = () => db.comanda.create({ data: { nomeAvulso: "Cliente sintético links", itens: { create: { descricao: "Corte sintético", quantidade: 1, precoUnitCentavos: 6000 } } } });
  const criar = (comandaId: string, valorCentavos = 6000) => criarLink(sessao, {
    comandaId, telefone: "11999990000", descricao: "Comanda sintética", valorCentavos,
    validadeDias: 1, parcelasMax: 1, enviar: false,
  });
  const primeira = await comanda();
  const duplo = await Promise.allSettled([criar(primeira.id), criar(primeira.id)]);
  assert.equal(duplo.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(await db.linkPagamento.count({ where: { comandaId: primeira.id } }), 1);
  assert.equal((await db.linkPagamento.aggregate({ where: { comandaId: primeira.id }, _sum: { valorCentavos: true } }))._sum.valorCentavos, 6000);

  const segunda = await comanda();
  await db.pagamentoComanda.create({ data: { comandaId: segunda.id, forma: "PIX", valorCentavos: 1000, status: "AGUARDANDO" } });
  await assert.rejects(() => criar(segunda.id, 1000), { codigo: "pagamento_pendente" });
  assert.equal(await db.linkPagamento.count({ where: { comandaId: segunda.id } }), 0);

  const terceira = await comanda();
  const corrida = await Promise.allSettled([
    criar(terceira.id),
    registrarPagamento(sessao, terceira.id, { forma: "DEBITO", valorCentavos: 6000, naMaquininha: true }),
  ]);
  assert.equal(corrida.filter((r) => r.status === "fulfilled").length, 1);
  const links = await db.linkPagamento.aggregate({ where: { comandaId: terceira.id, status: "PENDENTE" }, _sum: { valorCentavos: true } });
  const pos = await db.pagamentoComanda.aggregate({ where: { comandaId: terceira.id, status: "AGUARDANDO" }, _sum: { valorCentavos: true } });
  assert.equal((links._sum.valorCentavos ?? 0) + (pos._sum.valorCentavos ?? 0), 6000);

  const quarta = await comanda();
  await db.linkPagamento.create({ data: {
    token: `expirado-${quarta.id}`, descricao: "Link sintético expirado", nome: "Cliente sintético", telefone: "5511999990000",
    comandaId: quarta.id, valorCentavos: 6000, expiraEm: new Date(Date.now() - 60_000), criadoPorId: dono.id,
  } });
  assert.equal((await detalheComanda(quarta.id)).linksPagamento.length, 0);
  const pagamento = await registrarPagamento(sessao, quarta.id, { forma: "PIX", valorCentavos: 6000, naMaquininha: true });
  assert.equal(pagamento.status, "AGUARDANDO");
  assert(pagamento.gatewayPedidoId?.startsWith("sim_"));
  assert.equal(rede, 0);
  console.log("OK: links concorrentes, POS sem confirmação, disputa link/POS e link expirado; uma única reserva por saldo, zero rede externa.");
}

main().catch((erro) => { console.error(erro); process.exitCode = 1; }).finally(() => db.$disconnect());
