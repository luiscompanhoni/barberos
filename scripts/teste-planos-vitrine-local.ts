import assert from "node:assert/strict";

// Este script só aceita o banco local descartável destinado a este teste.
const alvo = "postgresql://recrutamento_teste@127.0.0.1:55439/codex_planos_20261104_a";
if (process.env.DATABASE_URL !== alvo || process.env.AMBIENTE !== "homologacao") {
  throw new Error("Teste recusado: use exclusivamente o banco descartável e AMBIENTE=homologacao.");
}

async function main() {
  const { db } = await import("@/lib/db");
  const { assinar, entrarNaListaDeEspera } = await import("@/lib/assinaturas/servico");
  try {
    await db.configuracao.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
    const suffix = `${Date.now()}`;
    const cliente = await db.cliente.create({ data: { nome: "Cliente fictício", telefone: `5500${suffix}`, cpf: "52998224725" } });
    const planos = await Promise.all([
      db.plano.create({ data: { nome: "Fictício A", precoCentavos: 10000, visivel: true, compravel: true } }),
      db.plano.create({ data: { nome: "Fictício B", precoCentavos: 10000, visivel: true, compravel: true } }),
      db.plano.create({ data: { nome: "Consulta fictícia", precoCentavos: 10000, visivel: true, compravel: false } }),
    ]);
    await assert.rejects(entrarNaListaDeEspera(cliente.id, planos[2].id));
    await assert.rejects(assinar({ clienteId: cliente.id, planoId: planos[2].id, forma: "PIX", origem: "SITE" }));
    assert.equal(await db.listaEsperaPlano.count({ where: { clienteId: cliente.id } }), 0);
    assert.equal(await db.assinatura.count({ where: { clienteId: cliente.id } }), 0);

    const cobrancasAntes = await db.cobrancaSimulada.count();
    const [a, b] = await Promise.allSettled(planos.slice(0, 2).map(p => assinar({ clienteId: cliente.id, planoId: p.id, forma: "PIX", origem: "SITE" })));
    if (a.status === "rejected" && b.status === "rejected") console.error("Falhas nas duas requisições fictícias:", a.reason, b.reason);
    assert.equal([a, b].filter(x => x.status === "fulfilled").length, 1, "apenas uma adesão concorrente pode ser criada");
    assert.equal([a, b].filter(x => x.status === "rejected").length, 1);
    const registros = await db.assinatura.findMany({ where: { clienteId: cliente.id } });
    assert.equal(registros.length, 1);
    assert.equal(registros[0].status, "PENDENTE");
    assert.equal(await db.cobrancaSimulada.count(), cobrancasAntes + 1, "somente uma cobrança simulada pode ser criada");

    const outro = planos.find(p => p.id !== registros[0].planoId && p.compravel)!;
    await assert.rejects(assinar({ clienteId: cliente.id, planoId: outro.id, forma: "PIX", origem: "SITE" }));
    assert.equal((await db.assinatura.findUniqueOrThrow({ where: { id: registros[0].id } })).status, "PENDENTE");

    const cliente2 = await db.cliente.create({ data: { nome: "Cliente fictício 2", telefone: `5501${suffix}`, cpf: "52998224725" } });
    const planoCorrida = await db.plano.create({ data: { nome: "Bloqueio concorrente", precoCentavos: 10000, visivel: true, compravel: true } });
    let tentativa: Promise<unknown> | undefined;
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM planos WHERE id = ${planoCorrida.id} FOR UPDATE`;
      tentativa = assinar({ clienteId: cliente2.id, planoId: planoCorrida.id, forma: "PIX", origem: "SITE" });
      let aguardouTrava = false;
      for (let i = 0; i < 25 && !aguardouTrava; i++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        const espera = await db.$queryRaw<{ total: bigint }[]>`SELECT COUNT(*) AS total FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FROM planos%FOR UPDATE%'`;
        aguardouTrava = Number(espera[0].total) > 0;
      }
      assert.equal(aguardouTrava, true, "a adesão deve realmente aguardar a trava antes da mudança");
      await tx.plano.update({ where: { id: planoCorrida.id }, data: { compravel: false } });
    });
    await assert.rejects(tentativa!);
    assert.equal(await db.assinatura.count({ where: { clienteId: cliente2.id } }), 0);
    assert.equal(await db.cobrancaSimulada.count(), cobrancasAntes + 1);
    console.log("Planos: bloqueio de consulta/fila, concorrência, desativação e preservação de pendência aprovados em banco descartável com gateway simulado.");
  } finally { await db.$disconnect(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
