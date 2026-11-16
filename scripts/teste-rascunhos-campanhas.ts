import assert from "node:assert/strict";
import type { Sessao } from "@/lib/auth/sessao";

const destino = new URL(process.env.DATABASE_URL ?? "http://invalido");
if (destino.hostname !== "127.0.0.1" || destino.port !== "55440" || destino.pathname !== "/barberos_campanhas_previa_20261116") {
  throw new Error("Use apenas o PostgreSQL descartável das campanhas.");
}

process.env.WHATSAPP_ENVIOS_BLOQUEADOS = "true";
process.env.WHATSAPP_PROVIDER = "simulador";
process.env.PAGAMENTOS_COBRANCAS_REAIS_BLOQUEADAS = "true";
globalThis.fetch = async () => { throw new Error("Rede externa bloqueada no ensaio."); };

async function main() {
  const { db } = await import("@/lib/db");
  const { MODELOS_SEGMENTOS } = await import("@/lib/campanhas/modelos-segmento");
  const { prepararCampanhasPorSegmento, editarCampanha, mudarStatus, liberarLote, processarCampanhas, listarCampanhas } = await import("@/lib/campanhas/servico");
  try {
    const dono = await db.usuario.findFirstOrThrow({ where: { papel: "DONO" } });
    const s: Sessao = { usuarioId: dono.id, nome: dono.nome, papel: "DONO", barbeiroId: null, clienteId: null };
    const ids = MODELOS_SEGMENTOS.map(m => m.id);
    await Promise.all([prepararCampanhasPorSegmento(s), prepararCampanhasPorSegmento(s)]);
    assert.equal((await prepararCampanhasPorSegmento(s)).criadas, 0);
    assert.equal(await db.campanha.count({ where: { id: { in: ids }, status: "PAUSADA" } }), ids.length);
    assert.equal((await listarCampanhas()).filter(c => ids.includes(c.id)).length, 16);

    const [modelo] = MODELOS_SEGMENTOS;
    const inicial = await db.campanha.findUniqueOrThrow({ where: { id: modelo.id } });
    const dados = { nome: inicial.nome, segmentos: inicial.segmentos, mensagem: inicial.mensagem,
      limiteDiario: inicial.limiteDiario, taxaRespostaBps: inicial.taxaRespostaBps, jogoId: inicial.jogoId };
    const editada = await editarCampanha(s, modelo.id, { ...dados, limiteDiario: 12 });
    assert.equal(editada.limiteDiario, 12);
    await prepararCampanhasPorSegmento(s);
    assert.equal((await db.campanha.findUniqueOrThrow({ where: { id: modelo.id } })).limiteDiario, 12);
    await assert.rejects(editarCampanha(s, modelo.id, { ...dados, segmentos: ["perdido"] }), /pertence ao card/);
    await editarCampanha(s, modelo.id, dados);

    await assert.rejects(mudarStatus(s, modelo.id, "retomar"), { codigo: "campanhas_bloqueadas" });
    await assert.rejects(liberarLote(s, modelo.id, 1), { codigo: "campanhas_bloqueadas" });
    assert.equal(await processarCampanhas(), 0);
    assert.equal(await db.campanhaEnvio.count({ where: { campanhaId: { in: ids } } }), 0);
    console.log("16 campanhas pausadas, atualização preservada, criação idempotente, público conferido e zero contatos na fila.");
  } finally {
    await db.$disconnect();
  }
}

void main().catch(e => { console.error(e); process.exitCode = 1; });
