import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { Modelo } from "@/lib/bot/agente";
import { criarExecucao, decidirExecucao, painelAgentes } from "@/lib/agentes/servico";
import { criarRotinaAgente, enfileirarRotinasAgentes } from "@/lib/agentes/rotinas";
import { processarUmaExecucao } from "@/lib/agentes/processar";
import { hashAgente } from "@/lib/agentes/regras";
import type { ContextoAgente } from "@/lib/agentes/contexto";

const contexto = async (_agente?: string, _usuario?: string, anterior: unknown = null): Promise<ContextoAgente> => ({ fontes: [], integracoes: [], limites: [], anterior });
const resultado = { resumo: "Briefing sintético preservado", entregaveis: ["Rascunho local"], alertas: [], proximosPassos: [] as { agenteId: string; tarefa: string }[] };
function modelo(r: unknown = resultado): Modelo {
  return { criar: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(r) }], usage: { input_tokens: 23, output_tokens: 45 } }) as Awaited<ReturnType<Modelo["criar"]>> };
}

/** Fixtures locais: a conferência compara valores e vínculos, não apenas contagens vazias. */
export async function prepararPreservacaoAgentes() {
  const lote = randomUUID(), data = new Date("2026-10-01T15:00:00Z");
  await db.$transaction(async tx => {
    const cliente = await tx.cliente.create({ data: { nome: "Cliente sintético de preservação", telefone: `fixture-agentes-${lote}`, aceitaMensagens: false } });
    const comanda = await tx.comanda.create({ data: { clienteId: cliente.id, status: "FECHADA", fechadaEm: data } });
    await tx.pagamentoComanda.create({ data: { comandaId: comanda.id, forma: "PIX", valorCentavos: 11800, status: "PAGO", estornadoCentavos: 1800, pagoEm: data } });
    await tx.despesa.create({ data: { descricao: "Despesa sintética de preservação", categoria: "OUTROS", valorCentavos: 12345, vencimento: data } });
    await tx.movimentoExterno.createMany({ data: [
      { fonte: "STONE", idExterno: `${lote}-entrada`, data, valorCentavos: 11800, tipo: "RECEBIMENTO", descricao: "Entrada sintética" },
      { fonte: "STONE", idExterno: `${lote}-estorno`, data, valorCentavos: -1800, tipo: "ESTORNO", descricao: "Estorno sintético" },
      { fonte: "STONE", idExterno: `${lote}-transferencia`, data, valorCentavos: -10000, tipo: "TRANSFERENCIA", descricao: "Transferência sintética" },
    ] });
  });
  const capturar = () => db.$transaction([
    db.cliente.findMany({ orderBy: { id: "asc" } }), db.comanda.findMany({ orderBy: { id: "asc" } }),
    db.pagamentoComanda.findMany({ orderBy: { id: "asc" } }), db.despesa.findMany({ orderBy: { id: "asc" } }),
    db.movimentoExterno.findMany({ orderBy: { id: "asc" } }),
  ]);
  const antes = await capturar();
  return async () => assert.deepEqual(await capturar(), antes, "A central não pode alterar dados financeiros ou seus vínculos");
}

/** Chamado apenas pelo runner que já valida o banco descartável e bloqueia a rede. */
export async function testarRevisaoAgentes() {
  const dono = await db.usuario.create({ data: { nome: "Revisão sintética", telefone: `agentes-revisao-${randomUUID()}`, papel: "DONO" } });
  let aprovados = 0;
  const falhas: string[] = [];
  const criar = (agenteId = "conteudo") => criarExecucao(dono.id, { agenteId, tarefa: "Preparar um rascunho para revisão sintética", chave: randomUUID() });
  const executar = (r: unknown = resultado) => processarUmaExecucao(dono.id, { modelo: modelo(r), contexto });
  const atual = (id: string) => db.agenteExecucao.findUniqueOrThrow({ where: { id } });
  async function verificar(nome: string, fn: () => Promise<void>) {
    try { await fn(); aprovados++; console.log(`OK ${nome}`); }
    catch (e) { falhas.push(nome); console.error(`FALHOU ${nome}: ${e instanceof Error ? e.message : "erro"}`); }
    finally {
      await db.agenteExecucao.updateMany({ where: { solicitanteId: dono.id, estado: { notIn: ["CONCLUIDO", "CANCELADO"] } }, data: { estado: "CANCELADO", lease: null, leaseAte: null } });
      await db.agenteRotina.updateMany({ where: { usuarioId: dono.id }, data: { ativa: false } });
    }
  }
  await verificar("resposta inválida preserva consumo conhecido e auditoria", async () => {
    const a = await criar(); await executar({ formato: "inválido" });
    const r = await atual(a.id);
    assert.equal(r.estado, "FALHOU"); assert.equal(r.resultado, null);
    assert.equal(r.tokensEntrada, 23); assert.equal(r.tokensSaida, 45);
    assert.equal(await db.auditoria.count({ where: { entidadeId: a.id, acao: "agente.consumo_falha" } }), 1);
  });
  await verificar("aprovação usa a vaga liberada pelo próprio trabalho em fila cheia", async () => {
    const a = await criar(); await executar({ ...resultado, proximosPassos: [{ agenteId: "trafego", tarefa: "Preparar plano local para revisão de tráfego" }] });
    const r = await atual(a.id);
    const abertas = await db.agenteExecucao.count({ where: { estado: { in: ["PENDENTE", "EXECUTANDO", "AGUARDA_APROVACAO"] } } });
    await db.agenteExecucao.createMany({ data: Array.from({ length: 100 - abertas }, (_, i) => ({ agenteId: "assistente", tarefa: "Ocupar fila somente como fixture", chave: randomUUID(), entradaHash: hashAgente({ i }), solicitanteId: dono.id })) });
    await decidirExecucao(dono.id, a.id, { acao: "aprovar", revisao: r.revisao, resultadoHash: r.resultadoHash! });
    assert.equal((await atual(a.id)).estado, "CONCLUIDO");
    assert.equal(await db.agenteExecucao.count({ where: { origemId: a.id } }), 1);
    assert.equal(await db.agenteExecucao.count({ where: { estado: { in: ["PENDENTE", "EXECUTANDO", "AGUARDA_APROVACAO"] } } }), 100);
  });
  await verificar("falha no segundo encaminhamento desfaz aprovação, primeiro filho e auditoria", async () => {
    const a = await criar(); await executar({ ...resultado, proximosPassos: [
      { agenteId: "trafego", tarefa: "Preparar plano local de tráfego" },
      { agenteId: "redes_sociais", tarefa: "Preparar rascunho social local" },
    ] });
    const r = await atual(a.id);
    const abertas = await db.agenteExecucao.count({ where: { estado: { in: ["PENDENTE", "EXECUTANDO", "AGUARDA_APROVACAO"] } } });
    await db.agenteExecucao.createMany({ data: Array.from({ length: 100 - abertas }, () => ({ agenteId: "conteudo", tarefa: "Fixture de rollback", chave: randomUUID(), entradaHash: "fixture", solicitanteId: dono.id })) });
    const auditorias = await db.auditoria.count();
    await assert.rejects(decidirExecucao(dono.id, a.id, { acao: "aprovar", revisao: r.revisao, resultadoHash: r.resultadoHash! }), /100 tarefas/);
    assert.deepEqual(await atual(a.id), r);
    assert.equal(await db.agenteExecucao.count({ where: { origemId: a.id } }), 0);
    assert.equal(await db.auditoria.count(), auditorias);
  });
  await verificar("repetição mantém rotina e bloqueia tentativas simultâneas da mesma falha", async () => {
    const r = await criarRotinaAgente(dono.id, { agenteId: "conteudo", tarefa: "Preparar um roteiro periódico sintético", chave: randomUUID(), nome: "Rotina de revisão", cadaMinutos: 60, ativa: true });
    const futuro = new Date(Date.now() + 3_600_001);
    await enfileirarRotinasAgentes(futuro);
    const a = await db.agenteExecucao.findFirstOrThrow({ where: { rotinaId: r.id } });
    await executar({ invalido: true });
    const falha = await atual(a.id);
    const nova = await decidirExecucao(dono.id, a.id, { acao: "repetir", revisao: falha.revisao });
    assert.equal((await atual(nova.id)).rotinaId, r.id);
    const repetida = await decidirExecucao(dono.id, a.id, { acao: "repetir", revisao: (await atual(a.id)).revisao });
    assert.equal(repetida.id, nova.id);
    await enfileirarRotinasAgentes(new Date(+futuro + 3_600_001));
    assert.equal(await db.agenteExecucao.count({ where: { rotinaId: r.id } }), 2);
    await executar({ invalido: true });
    await enfileirarRotinasAgentes(new Date(+futuro + 7_200_002));
    await assert.rejects(decidirExecucao(dono.id, a.id, { acao: "repetir", revisao: (await atual(a.id)).revisao }), /rotina já tem/);
    assert.equal(await db.agenteExecucao.count({ where: { rotinaId: r.id } }), 3);
  });
  await verificar("rotina vencida respeita fila cheia sem bloquear o trabalhador", async () => {
    await criarRotinaAgente(dono.id, { agenteId: "conteudo", tarefa: "Preparar um roteiro periódico sintético", chave: randomUUID(), nome: "Rotina com fila cheia", cadaMinutos: 60, ativa: true });
    const abertas = await db.agenteExecucao.count({ where: { estado: { in: ["PENDENTE", "EXECUTANDO", "AGUARDA_APROVACAO"] } } });
    await db.agenteExecucao.createMany({ data: Array.from({ length: 100 - abertas }, (_, i) => ({ agenteId: "conteudo", tarefa: "Fixture para ocupar a fila", chave: randomUUID(), entradaHash: hashAgente({ i }), solicitanteId: dono.id })) });
    assert.equal(await enfileirarRotinasAgentes(new Date(Date.now() + 3_600_001)), 0);
    assert.equal((await executar()).processado, true);
  });
  await verificar("repetição de um encaminhamento preserva o briefing de origem", async () => {
    const pai = await criar("estrategia");
    await executar({ ...resultado, proximosPassos: [{ agenteId: "conteudo", tarefa: "Preparar conteúdo com base no briefing recebido" }] });
    const filho = await db.agenteExecucao.findFirstOrThrow({ where: { origemId: pai.id } });
    await executar({ invalido: true });
    const retry = await decidirExecucao(dono.id, filho.id, { acao: "repetir", revisao: (await atual(filho.id)).revisao });
    assert.equal((await atual(retry.id)).origemId, pai.id);
    await executar();
    const c = (await atual(retry.id)).contexto as { anterior: { resultado: { resumo: string } } };
    assert.equal(c.anterior.resultado.resumo, resultado.resumo);
    assert.equal(await db.auditoria.count({ where: { entidadeId: filho.id, acao: "agente.tarefa_repetida" } }), 1);
  });
  await verificar("reserva que vence durante a coleta não inicia chamada de IA", async () => {
    const a = await criar(); let chamadas = 0;
    await processarUmaExecucao(dono.id, { modelo: { criar: async p => { chamadas++; return modelo().criar(p); } }, contexto: async () => {
      await db.agenteExecucao.update({ where: { id: a.id }, data: { leaseAte: new Date(Date.now() - 1_000) } });
      return contexto();
    } });
    assert.equal(chamadas, 0); assert.equal((await atual(a.id)).estado, "FALHOU");
  });
  await verificar("painel conserva pendência antiga mesmo após mais de 100 encerramentos", async () => {
    const a = await criar();
    await db.agenteExecucao.update({ where: { id: a.id }, data: { criadoEm: new Date("2020-01-01T00:00:00Z") } });
    await db.agenteExecucao.createMany({ data: Array.from({ length: 110 }, () => ({ agenteId: "conteudo", tarefa: "Histórico sintético encerrado", chave: randomUUID(), entradaHash: "fixture", solicitanteId: dono.id, estado: "CANCELADO" })) });
    const p = await painelAgentes(dono.id);
    assert.ok(p.execucoes.some(e => e.id === a.id)); assert.equal(p.execucoes.length, 100);
  });
  await verificar("outro dono não lê nem altera trabalho alheio", async () => {
    const a = await criar();
    const outro = await db.usuario.create({ data: { nome: "Outro dono sintético", telefone: `agentes-outro-${randomUUID()}`, papel: "DONO" } });
    assert.equal((await painelAgentes(outro.id)).execucoes.some(e => e.id === a.id), false);
    await assert.rejects(decidirExecucao(outro.id, a.id, { acao: "cancelar", revisao: a.revisao }), /não encontrado/);
    assert.equal((await atual(a.id)).estado, "PENDENTE");
  });
  assert.deepEqual(falhas, [], "Regressões da revisão precisam passar");
  return aprovados;
}
