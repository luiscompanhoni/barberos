import assert from "node:assert/strict";
const alvo = "postgresql://recrutamento_teste@127.0.0.1:55439/codex_planos_20261104_a";
if (process.env.DATABASE_URL !== alvo || process.env.AMBIENTE !== "homologacao") throw new Error("Use somente o banco descartável e homologação.");

async function main() {
  const { db } = await import("@/lib/db");
  const { atualizarPremios, reservarPremio, validarPremio } = await import("@/lib/jogos/premios");
  try {
    const n = `${Date.now()}`;
    const usuario = await db.usuario.create({ data: { nome: "Operador fictício", telefone: `5580${n}`, papel: "DONO" } });
    const barbeiro = await db.barbeiro.create({ data: { nome: "Profissional fictício", usuarioId: usuario.id } });
    const cliente = await db.cliente.create({ data: { nome: "Cliente fictício", telefone: `5581${n}` } });
    const servico = await db.servico.create({ data: { nome: "Serviço fictício", precoCentavos: 1000, duracaoMin: 30 } });
    const inicio = new Date(Date.now() + 86400000);
    const ag = await db.agendamento.create({ data: { barbeiroId: barbeiro.id, clienteId: cliente.id, servicoId: servico.id, inicio, fim: new Date(+inicio + 1800000), origem: "SITE", precoCentavos: 1000 } });
    const jogo = await db.jogo.create({ data: { id: `jogo-${n}`, nome: "Teste fictício", tipo: "ROLETA" } });
    const jogada = await db.jogada.create({ data: { chave: `chave-${n}`, jogoId: jogo.id, clienteId: cliente.id, tipo: "ROLETA", origem: "MANUAL", vitoria: true, resultado: {} } });
    const premio = await db.premioGanho.create({ data: { codigo: `T-${n}`, clienteId: cliente.id, jogadaId: jogada.id, jogoId: jogo.id, rotulo: "Brinde fictício", tipo: "BRINDE", raridade: "COMUM", icone: "presente", status: "DISPONIVEL" } });

    let valida: Promise<unknown> | undefined, reserva: Promise<unknown> | undefined;
    const aguardarBloqueados = async (quantidade: number) => {
      for (let i = 0; i < 30; i++) {
        await new Promise(resolve => setTimeout(resolve, 50));
        const q = await db.$queryRaw<{ total: bigint }[]>`SELECT COUNT(*) AS total FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FROM premios_ganhos%FOR UPDATE%'`;
        if (Number(q[0].total) >= quantidade) return;
      }
      throw new Error(`As ${quantidade} operações de prêmio não aguardaram a trava esperada.`);
    };
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 FROM premios_ganhos WHERE id = ${premio.id} FOR UPDATE`;
      valida = validarPremio({ usuarioId: usuario.id, nome: usuario.nome, papel: "DONO", barbeiroId: barbeiro.id, clienteId: null }, premio.id, {});
      void valida.catch(() => {});
      await aguardarBloqueados(1);
      reserva = db.$transaction(t => reservarPremio(t, cliente.id, premio.id, ag));
      void reserva.catch(() => {});
      await aguardarBloqueados(2);
    }, { timeout: 10000 });
    const [r1, r2] = await Promise.allSettled([valida!, reserva!]);
    assert.equal(r1.status, "fulfilled", "a validação deve acontecer primeiro");
    assert.equal(r2.status, "rejected", "a reserva deve recusar prêmio utilizado");
    const final = await db.premioGanho.findUniqueOrThrow({ where: { id: premio.id } });
    assert.equal(final.status, "UTILIZADO");
    assert.equal(final.agendamentoId, null);

    const jogada2 = await db.jogada.create({ data: { chave: `chave2-${n}`, jogoId: jogo.id, clienteId: cliente.id, tipo: "ROLETA", origem: "MANUAL", vitoria: true, resultado: {} } });
    await db.agendamento.update({ where: { id: ag.id }, data: { status: "CANCELADO" } });
    const premio2 = await db.premioGanho.create({ data: { codigo: `T2-${n}`, clienteId: cliente.id, jogadaId: jogada2.id, jogoId: jogo.id, rotulo: "Brinde fictício 2", tipo: "BRINDE", raridade: "COMUM", icone: "presente", status: "RESERVADO", agendamentoId: ag.id } });
    let atualizar: Promise<void> | undefined;
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 FROM premios_ganhos WHERE id = ${premio2.id} FOR UPDATE`;
      atualizar = atualizarPremios({ clienteId: cliente.id });
      void atualizar.catch(() => {});
      let bloqueou = false;
      for (let i = 0; i < 30 && !bloqueou; i++) {
        await new Promise(resolve => setTimeout(resolve, 50));
        const q = await db.$queryRaw<{ total: bigint }[]>`SELECT COUNT(*) AS total FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%UPDATE%premios_ganhos%'`;
        bloqueou = Number(q[0].total) > 0;
      }
      assert.equal(bloqueou, true, "a liberação automática deve aguardar a trava");
      await tx.premioGanho.update({ where: { id: premio2.id }, data: { status: "UTILIZADO", utilizadoEm: new Date() } });
    }, { timeout: 10000 });
    await atualizar;
    assert.equal((await db.premioGanho.findUniqueOrThrow({ where: { id: premio2.id } })).status, "UTILIZADO");
    console.log("Reserva, validação e liberação automática concorrentes preservaram os prêmios utilizados.");
  } finally { await db.$disconnect(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
