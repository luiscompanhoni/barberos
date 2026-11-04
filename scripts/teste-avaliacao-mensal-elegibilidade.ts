/** Exclusivamente banco local descartável; não gera fichas, notificações ou avaliações. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { competenciaDaCobranca, prepararElegibilidadeMensal, pularAvaliacaoMensal } from "@/lib/avaliacoes/mensal-elegibilidade";
import { excluirConta, exportarDados } from "@/lib/lgpd/titular";

const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (url.hostname !== "127.0.0.1" || url.port !== "55439" || url.pathname !== "/barberos_avaliacao_mensal_teste_20261103") throw Error("Use exclusivamente o banco descartável de avaliações mensais.");
globalThis.fetch = async () => { throw Error("Rede bloqueada no teste"); };
async function main() {
  const tag = randomUUID();
  const c = await db.cliente.create({ data: { nome: "Cliente fictício", telefone: tag } });
  const outro = await db.cliente.create({ data: { nome: "Outro cliente fictício", telefone: tag + "x" } });
  const plano = await db.plano.create({ data: { nome: "Plano fictício", precoCentavos: 10000 } });
  const a = await db.assinatura.create({ data: { clienteId: c.id, planoId: plano.id, status: "ATIVA", formaPagamento: "PIX", precoCentavos: 10000, origem: "SITE" } });
  const cob = (sufixo: string, vencimento: string, status: "PENDENTE" | "PAGA", pagaEm: Date | null) => db.cobranca.create({ data: { assinaturaId: a.id, gatewayId: tag + sufixo, valorCentavos: 10000, vencimento: new Date(vencimento), status, pagaEm } });
  const pendente = await cob("pendente", "2031-03-05", "PENDENTE", null);
  await assert.rejects(prepararElegibilidadeMensal(c.id, pendente.id), /não está paga/);
  const paga = await cob("paga", "2031-04-05", "PAGA", new Date("2031-04-05T12:00:00Z"));
  await assert.rejects(prepararElegibilidadeMensal(outro.id, paga.id), /não encontrado/);
  assert.equal(competenciaDaCobranca(new Date("2031-04-05")), "2031-04");
  const fichasAntes = await db.fichaJogo.count();
  const concorrentes = await Promise.all(Array.from({ length: 4 }, () => prepararElegibilidadeMensal(c.id, paga.id)));
  assert.equal(concorrentes.filter((x) => !x.repetida).length, 1);
  assert.equal(await db.avaliacaoMensalElegibilidade.count({ where: { clienteId: c.id } }), 1);
  const duplicada = await cob("mesmo-mes", "2031-04-22", "PAGA", new Date("2031-04-22T12:00:00Z"));
  assert.equal((await prepararElegibilidadeMensal(c.id, duplicada.id)).repetida, true);
  await assert.rejects(pularAvaliacaoMensal(outro.id, "2031-04"), /não encontrado/);
  assert.equal((await pularAvaliacaoMensal(c.id, "2031-04")).repetida, false);
  assert.equal((await pularAvaliacaoMensal(c.id, "2031-04")).repetida, true);
  assert.equal(await db.fichaJogo.count(), fichasAntes);
  await db.cobranca.update({ where: { id: paga.id }, data: { status: "ESTORNADA" } });
  await assert.rejects(pularAvaliacaoMensal(c.id, "2031-04"), /não está paga/);
  const resposta = await db.avaliacaoCliente.count();
  assert.equal(resposta, 0);
  const exportado = await exportarDados(c.id);
  assert.equal(exportado.dados.elegibilidadesMensais[0].competencia, "2031-04");
  await db.cobranca.update({ where: { id: pendente.id }, data: { status: "CANCELADA" } });
  await db.assinatura.update({ where: { id: a.id }, data: { status: "CANCELADA" } });
  const usuario = await db.usuario.create({ data: { nome: "Cliente fictício", telefone: tag + "u", papel: "CLIENTE" } });
  await db.cliente.update({ where: { id: c.id }, data: { usuarioId: usuario.id } });
  await excluirConta(c.id, usuario.id);
  assert.equal(await db.avaliacaoMensalElegibilidade.count({ where: { clienteId: c.id } }), 0);
  assert.equal((await db.cobranca.findUniqueOrThrow({ where: { id: paga.id } })).status, "ESTORNADA");
  await assert.rejects(prepararElegibilidadeMensal(c.id, duplicada.id), /não encontrado/);
  console.log("OK elegibilidade mensal, idempotência, posse, pular, estorno e ausência de fichas/respostas");
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
