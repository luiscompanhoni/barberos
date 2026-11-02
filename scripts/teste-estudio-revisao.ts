import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { importarRoteiro, listarRoteiros } from "@/lib/estudio/roteiros";
import { hashAgente } from "@/lib/agentes/regras";
import { claim, criar, enfileirar, finalizar, heartbeat, listar, projeto } from "@/lib/estudio/servico";
import { WORKER_1080 } from "@/lib/estudio/templates";

const rejeita = async (p: Promise<unknown>, status: number) => assert.rejects(p, (e: unknown) => typeof e === "object" && e !== null && "status" in e && e.status === status);

export async function testarRevisaoEstudio(ok: (nome: string) => void) {
  const lote = randomUUID();
  const dono = await db.usuario.create({ data: { nome: "Revisão Estúdio", telefone: `revisao-estudio-${lote}`, papel: "DONO" } });
  const outro = await db.usuario.create({ data: { nome: "Outro responsável", telefone: `revisao-outro-${lote}`, papel: "DONO" } });
  const resultado = { resumo: "Roteiro sintético", entregaveis: ["Cena de teste"], alertas: [], proximosPassos: [] };
  const comum = { agenteId: "conteudo", tarefa: "Preparar vídeo sintético para revisão", entradaHash: "fixture", resultado, resultadoHash: hashAgente(resultado), estado: "CONCLUIDO" as const, aprovadoPorId: dono.id, aprovadoEm: new Date() };
  const antigo = await db.agenteExecucao.create({ data: { ...comum, chave: `antigo-${lote}`, solicitanteId: dono.id, aprovadoEm: new Date("2020-01-01T00:00:00Z") } });
  await db.agenteExecucao.createMany({ data: Array.from({ length: 51 }, (_, i) => ({ ...comum, chave: `${lote}-${i}`, solicitanteId: dono.id })) });
  assert.equal((await listarRoteiros(dono.id)).length, 50);
  const selecionado = await listarRoteiros(dono.id, antigo.id);
  assert.ok(selecionado.some(r => r.id === antigo.id)); assert.equal(new Set(selecionado.map(r => r.id)).size, selecionado.length);
  assert.equal((await listarRoteiros(outro.id, antigo.id)).length, 0);
  ok("C1: atalho recupera roteiro antigo aprovado sem duplicidade ou acesso cruzado");
  const importado = await importarRoteiro(dono.id, { execucaoId: antigo.id, nome: "Privado da Central", revisao: antigo.revisao, resultadoHash: antigo.resultadoHash! });
  const manual = await criar(dono.id, "Projeto da equipe");
  await db.estudioClipe.create({ data: { projetoId: importado.id, nome: "sintetico.mp4", mime: "video/mp4", bytes: 64, duracao: 2, inicio: 0, fim: 2, arquivo: "fixture-permissao", posicao: 0 } });
  await claim(WORKER_1080);
  const versaoId = await enfileirar(dono.id, importado.id, 0);
  try {
    await db.usuario.update({ where: { id: dono.id }, data: { papel: "BARBEIRO" } });
    assert.equal((await listar(dono.id)).projetos.some(p => p.id === importado.id), false);
    assert.equal((await listar(dono.id)).projetos.some(p => p.id === manual), true);
    await rejeita(projeto(db, dono.id, importado.id), 404);
    await rejeita(enfileirar(dono.id, importado.id, 0), 404);
    assert.equal(await claim(WORKER_1080), null);
    ok("C3: revogação do papel protege roteiro importado e fila; projeto manual continua disponível");
    await db.usuario.update({ where: { id: dono.id }, data: { papel: "DONO" } });
    const job = await claim(WORKER_1080); assert.equal(job?.id, versaoId); assert.ok(job);
    await db.usuario.update({ where: { id: dono.id }, data: { papel: "BARBEIRO" } });
    await rejeita(heartbeat(job.id, job.lease), 409);
    await rejeita(finalizar(job.id, job.lease, { chave: "fixture-tardio", bytes: 64, hash: "a".repeat(64) }), 409);
    await db.usuario.update({ where: { id: dono.id }, data: { papel: "DONO" } });
    assert.equal((await projeto(db, dono.id, importado.id)).roteiro !== null, true);
    ok("C3: lease perde validade após revogação sem apagar o projeto ou a origem");
  } finally {
    await db.estudioVersao.update({ where: { id: versaoId }, data: { estado: "CANCELADO", lease: null, leaseAte: null, bytes: 0 } });
  }
}
