/** Ciclo 2: apenas fixtures próprias no PostgreSQL local; sem rede/Configuração/limpeza global. */
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import type { Sessao } from "@/lib/auth/sessao";
const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (url.hostname !== "127.0.0.1" || url.port !== "15439" || url.pathname !== "/barberos_cliente_teste_20261104") throw new Error("Use somente o banco local dedicado.");
process.env.AMBIENTE = "homologacao";
process.env.WHATSAPP_PROVIDER = "simulador";
globalThis.fetch = async () => { throw new Error("Rede externa bloqueada no ensaio de agenda"); };
const telefone = () => `55119${randomInt(10_000_000, 100_000_000)}`;

async function main() {
  const { db } = await import("@/lib/db");
  const { criarPedido, decidirPedido } = await import("@/lib/agenda/pedidos");
  const { criarAgendamento, alterarAgendamento, alterarStatus } = await import("@/lib/agenda/agendamentos");
  const { agendarPeloCliente } = await import("@/lib/agenda/cliente");
  const { excluirConta } = await import("@/lib/lgpd/titular");
  const { solicitarAlteracaoPlano, aplicarAlteracaoPlano } = await import("@/lib/assinaturas/alteracao-plano");
  const { dataLocal, somarDias, instanteLocal } = await import("@/lib/agenda/tempo");
  const tag = `QA C2 agenda ${randomUUID().slice(0, 8)}`;
  const cfg = await db.configuracao.findUniqueOrThrow({ where: { id: 1 } });
  assert(cfg.agendaExternaAtiva, "Ensaio de pedidos requer confirmação por equipe já ativa");
  const hoje = dataLocal(Date.now(), cfg.fuso), amanha = somarDias(hoje, 1), ontem = somarDias(hoje, -1);
  const instante = (dia: string, minuto: number) => new Date(instanteLocal(dia, minuto, cfg.fuso));
  const dono = await db.usuario.create({ data: { nome: tag, telefone: telefone(), papel: "DONO" } });
  const ator: Sessao = { usuarioId: dono.id, nome: tag, papel: "DONO", barbeiroId: null, clienteId: null };
  const barbeiro = await db.barbeiro.create({ data: { nome: tag, usuario: { create: { nome: tag, telefone: telefone(), papel: "BARBEIRO" } },
    expediente: { create: Array.from({ length: 7 }, (_, diaSemana) => ({ diaSemana, inicioMin: 480, fimMin: 1200 })) } } });
  const corte = await db.servico.create({ data: { nome: `${tag} corte`, precoCentavos: 5000, duracaoMin: 30 } });
  const barba = await db.servico.create({ data: { nome: `${tag} barba`, precoCentavos: 3000, duracaoMin: 30 } });
  await db.barbeiroServico.createMany({ data: [corte, barba].map(s => ({ barbeiroId: barbeiro.id, servicoId: s.id })) });
  async function cliente() {
    const u = await db.usuario.create({ data: { nome: tag, telefone: telefone(), papel: "CLIENTE", telefoneVerificadoEm: new Date() } });
    const c = await db.cliente.create({ data: { nome: tag, telefone: u.telefone, usuarioId: u.id } });
    return { c, u };
  }
  const entrada = () => ({ chave: randomUUID(), servicoIds: [corte.id], barbeiroId: barbeiro.id, dataPreferida: amanha, horaPreferida: "10:00", observacao: "Observação sintética para apagar" });
  async function esperar(chave: string, n: number) {
    const limite = Date.now() + 8_000;
    while (Date.now() < limite) {
      const r = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND objid::bigint = (hashtext(${chave})::bigint & 4294967295)`;
      if (Number(r[0].n) >= n) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error("Fila de concorrência não foi observada");
  }
  async function disputar(chave: string, primeiro: () => Promise<unknown>, segundo: () => Promise<unknown>) {
    let liberar!: () => void, entrou!: () => void;
    const liberado = new Promise<void>(r => { liberar = r; }), iniciado = new Promise<void>(r => { entrou = r; });
    const bloqueador = db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chave}))`; entrou(); await liberado;
    }, { timeout: 20_000 });
    await iniciado;
    const resultado = (p: Promise<unknown>) => p.then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
    try {
      const a = resultado(primeiro()); await esperar(chave, 1);
      const b = resultado(segundo()); await esperar(chave, 2);
      liberar(); await bloqueador;
      return await Promise.all([a, b]);
    } finally { liberar(); await bloqueador; }
  }
  const originalAgora = Date.now;
  try {
    const apagado = await cliente();
    const [excluiu, pedido] = await disputar(`auth-usuario:${apagado.u.id}`,
      () => excluirConta(apagado.c.id, apagado.u.id, 0), () => criarPedido(apagado.c.id, apagado.u.id, entrada(), 0));
    assert(excluiu.ok); assert(!pedido.ok);
    assert.equal(await db.pedidoAgendamento.count({ where: { clienteId: apagado.c.id } }), 0);
    await assert.rejects(agendarPeloCliente({ clienteId: apagado.c.id, usuarioId: apagado.u.id, sessaoVersao: 0,
      telefone: apagado.c.telefone, nome: apagado.c.nome, barbeiroId: barbeiro.id, servicoId: corte.id, inicio: instante(amanha, 600), origem: "SITE" }), /Cliente ativo/);
    assert.equal(await db.cliente.count({ where: { telefone: apagado.c.telefone } }), 0, "App não pode recriar cadastro pelo telefone antigo");

    const pendente = await cliente();
    const p = await criarPedido(pendente.c.id, pendente.u.id, entrada());
    const [apagouAntes, aprovouDepois] = await disputar(`cliente-ciclo:${pendente.c.id}`,
      () => excluirConta(pendente.c.id, pendente.u.id), () => decidirPedido(p.id, ator, { acao: "aprovar", barbeiroId: barbeiro.id,
        inicio: instante(amanha, 660), conferido: true, precoEsperadoCentavos: 5000, duracaoEsperadaMin: 30 }));
    assert(apagouAntes.ok); assert(!aprovouDepois.ok);
    const pedidoFinal = await db.pedidoAgendamento.findUniqueOrThrow({ where: { id: p.id } });
    assert.equal(pedidoFinal.status, "CANCELADO"); assert.equal(pedidoFinal.observacao, null);
    assert.equal(await db.agendamento.count({ where: { clienteId: pendente.c.id } }), 0);

    const reserva = await cliente();
    const [reservou, bloqueouExclusao] = await disputar(`cliente-ciclo:${reserva.c.id}`,
      () => criarAgendamento({ cliente: { id: reserva.c.id }, barbeiroId: barbeiro.id, servicoId: corte.id, inicio: instante(amanha, 720), origem: "RECEPCAO" }, ator),
      () => excluirConta(reserva.c.id, reserva.u.id));
    assert(reservou.ok); assert(!bloqueouExclusao.ok && bloqueouExclusao.error.codigo === "exclusao_bloqueada");
    assert.equal((await db.cliente.findUniqueOrThrow({ where: { id: reserva.c.id } })).excluidoEm, null);

    const antigo = await db.plano.create({ data: { nome: `${tag} antigo`, precoCentavos: 15000, maxAgendamentosAbertos: 1, servicos: { create: { servicoId: corte.id, usosPorCiclo: 1 } } } });
    const novo = await db.plano.create({ data: { nome: `${tag} novo`, precoCentavos: 10000, maxAgendamentosAbertos: 1, servicos: { create: { servicoId: barba.id, usosPorCiclo: 1 } } } });
    async function contrato() {
      const titular = await cliente();
      const a = await db.assinatura.create({ data: { clienteId: titular.c.id, planoId: antigo.id, status: "ATIVA", formaPagamento: "PIX", precoCentavos: 15000,
        origem: "SITE", gatewayId: `pixrec_qa_c2_${randomUUID()}`, cicloInicio: new Date(`${ontem}T00:00:00Z`), proximoVencimento: new Date(`${hoje}T00:00:00Z`) } });
      Date.now = () => +instante(ontem, 600);
      try { await solicitarAlteracaoPlano({ assinaturaId: a.id, planoId: novo.id, origem: "SITE", usuarioId: titular.u.id }); }
      finally { Date.now = originalAgora; }
      return { ...titular, a };
    }
    const mover = await contrato();
    const ag = await db.agendamento.create({ data: { clienteId: mover.c.id, barbeiroId: barbeiro.id, servicoId: corte.id,
      inicio: instante(ontem, 600), fim: instante(ontem, 630), precoCentavos: 0, assinaturaId: mover.a.id, origem: "SITE" } });
    const [trocou, naoMoveu] = await disputar(`cliente:${mover.c.id}`, () => aplicarAlteracaoPlano(mover.a.id, dono.id),
      () => alterarAgendamento(ag.id, { inicio: instante(amanha, 840) }, ator));
    assert(trocou.ok); assert(!naoMoveu.ok && naoMoveu.error.codigo === "cobertura_alterada");
    assert.equal(+(await db.agendamento.findUniqueOrThrow({ where: { id: ag.id } })).inicio, +ag.inicio);

    const cancelado = await db.agendamento.create({ data: { clienteId: mover.c.id, barbeiroId: barbeiro.id, servicoId: corte.id, status: "CANCELADO",
      inicio: instante(amanha, 900), fim: instante(amanha, 930), precoCentavos: 0, assinaturaId: mover.a.id, origem: "SITE" } });
    await assert.rejects(alterarStatus(cancelado.id, "MARCADO", ator), /cobertura do plano mudou/);
    assert.equal((await db.agendamento.findUniqueOrThrow({ where: { id: cancelado.id } })).status, "CANCELADO");

    // Mesmo sem troca de plano, reativar não pode usar novamente uma quota já ocupada.
    const quota = await contrato();
    await db.agendamento.create({ data: { clienteId: quota.c.id, barbeiroId: barbeiro.id, servicoId: corte.id,
      inicio: instante(amanha, 960), fim: instante(amanha, 990), precoCentavos: 0, assinaturaId: quota.a.id, origem: "SITE" } });
    const outro = await db.agendamento.create({ data: { clienteId: quota.c.id, barbeiroId: barbeiro.id, servicoId: corte.id, status: "CANCELADO",
      inicio: instante(amanha, 1020), fim: instante(amanha, 1050), precoCentavos: 0, assinaturaId: quota.a.id, origem: "SITE" } });
    await assert.rejects(alterarStatus(outro.id, "MARCADO", ator), /1 horário marcado/);
    assert.equal((await db.agendamento.findUniqueOrThrow({ where: { id: outro.id } })).status, "CANCELADO");
    console.log("PASS C2: exclusão×pedido/aprovação, app não recria cadastro, reserva×exclusão, downgrade×remarcação, reativação sem cobertura/quota. Sem configuração alterada, rede ou dinheiro; auditorias preservadas.");
  } finally { Date.now = originalAgora; await db.$disconnect(); }
}
main().catch((e: unknown) => { console.error(e); process.exitCode = 1; });
