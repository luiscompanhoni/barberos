/** Teste com registros fictícios, exclusivo do banco local descartável indicado. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { listarProfissionaisAvaliaveis } from "@/lib/avaliacoes/mensal-profissionais";

const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (url.hostname !== "127.0.0.1" || url.port !== "55439" || url.pathname !== "/barberos_avaliacao_mensal_teste_20261103") {
  throw new Error("Use exclusivamente o banco descartável de avaliações mensais.");
}
globalThis.fetch = async () => { throw new Error("Rede bloqueada no teste."); };

async function main() {
  const tag = randomUUID();
  const cliente = await db.cliente.create({ data: { nome: "Cliente fictício", telefone: tag } });
  const outro = await db.cliente.create({ data: { nome: "Outro cliente", telefone: `${tag}-outro` } });
  const plano = await db.plano.create({ data: { nome: "Plano fictício", precoCentavos: 10000 } });
  const assinatura = await db.assinatura.create({ data: { clienteId: cliente.id, planoId: plano.id, status: "ATIVA", formaPagamento: "PIX", precoCentavos: 10000, origem: "SITE" } });
  const cobranca = await db.cobranca.create({ data: { assinaturaId: assinatura.id, gatewayId: tag, valorCentavos: 10000,
    vencimento: new Date("2026-11-05T00:00:00Z"), status: "PAGA", pagaEm: new Date("2026-11-01T03:00:00Z") } });
  const servico = await db.servico.create({ data: { nome: "Serviço teste", duracaoMin: 30, precoCentavos: 1000 } });
  async function barbeiro(sufixo: string) {
    return db.barbeiro.create({ data: { nome: `Profissional ${sufixo}`, usuario: { create: { nome: sufixo, telefone: `${tag}-${sufixo}`, papel: "BARBEIRO" } } } });
  }
  const b1 = await barbeiro("um");
  const b2 = await barbeiro("dois");
  const b3 = await barbeiro("tres");
  const dados = (barbeiroId: string, clienteId: string, inicio: string, status: "CONCLUIDO" | "CANCELADO") => ({
    barbeiroId, clienteId, servicoId: servico.id, inicio: new Date(inicio), fim: new Date(+new Date(inicio) + 30 * 60_000),
    origem: "RECEPCAO" as const, status, precoCentavos: 1000,
  });
  await db.agendamento.createMany({ data: [
    dados(b1.id, cliente.id, "2026-10-01T03:00:00Z", "CONCLUIDO"),
    dados(b1.id, cliente.id, "2026-10-15T15:00:00Z", "CONCLUIDO"),
    dados(b2.id, cliente.id, "2026-11-01T02:59:00Z", "CONCLUIDO"),
    dados(b3.id, cliente.id, "2026-11-01T03:00:00Z", "CONCLUIDO"),
    dados(b3.id, cliente.id, "2026-10-20T15:00:00Z", "CANCELADO"),
    dados(b3.id, outro.id, "2026-10-20T15:00:00Z", "CONCLUIDO"),
  ] });
  const antes = await db.avaliacaoCliente.count();
  const lista = await listarProfissionaisAvaliaveis(cliente.id, cobranca.id, new Date("2026-11-03T12:00:00Z"));
  assert.equal(lista.competencia, "2026-10");
  assert.deepEqual(new Set(lista.profissionais.map((p) => p.id)), new Set([b1.id, b2.id]));
  assert.equal(lista.profissionais.length, 2);
  assert.equal(await db.avaliacaoCliente.count(), antes);
  await assert.rejects(listarProfissionaisAvaliaveis(outro.id, cobranca.id, new Date("2026-11-03T12:00:00Z")));
  console.log("OK profissionais com atendimento concluído, mês local, duplicidade, cliente e sem gravação de voto");
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
