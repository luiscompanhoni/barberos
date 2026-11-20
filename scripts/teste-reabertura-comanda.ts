import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { abrirComanda, cancelarComanda } from "@/lib/comandas/servico";
import { cancelarPeloCliente, remarcarPeloCliente } from "@/lib/agenda/cliente";
import type { Sessao } from "@/lib/auth/sessao";

async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, "127.0.0.1");
  assert.match(url.pathname, /^\/barberos_op_\d{8}_\d+$/);
  const dono = await db.usuario.findFirstOrThrow({ where: { papel: "DONO" } });
  const s: Sessao = { usuarioId: dono.id, nome: dono.nome, papel: "DONO", barbeiroId: null, clienteId: null };
  const barbeiro = await db.barbeiro.findFirstOrThrow({ where: { nome: "Joao" } });
  const servicos = await db.servico.findMany({ where: { nome: { in: ["Corte", "Barba"] } }, orderBy: { ordem: "asc" } });
  const dia = new Date(Date.now() + 7 * 86400000);
  while (dia.getUTCDay() !== 3) dia.setUTCDate(dia.getUTCDate() + 1);
  dia.setUTCHours(12, 0, 0, 0); // 9h em São Paulo.

  for (const grupo of [false, true]) {
    const cliente = await db.cliente.create({ data: { nome: "Teste reabertura", telefone: randomUUID() } });
    const inicio = +dia + (grupo ? 4 : 0) * 3600000;
    const dados = { clienteId: cliente.id, barbeiroId: barbeiro.id, origem: "SITE" as const };
    const ag = await db.agendamento.create({ data: { ...dados, inicio: new Date(inicio), fim: new Date(inicio + (grupo ? 60 : 30) * 60000),
      servicoId: servicos[0].id, precoCentavos: servicos[0].precoCentavos } });
    if (grupo) await db.agendamento.create({ data: { ...dados, adicionalDeId: ag.id, servicoId: servicos[1].id,
      precoCentavos: servicos[1].precoCentavos, inicio: new Date(inicio + 30 * 60000), fim: ag.fim } });
    const abrir = () => abrirComanda(s, { agendamentoId: ag.id });
    const primeira = await abrir();
    const itens = await db.itemComanda.findMany({ where: { comandaId: primeira.id }, orderBy: { id: "asc" } });
    assert.equal(itens.length, grupo ? 2 : 1);
    await cancelarComanda(s, primeira.id, "Teste de reabertura");
    const historico = await db.auditoria.findFirstOrThrow({ where: { acao: "liberar_agendamentos", entidadeId: primeira.id } });
    assert.deepEqual(historico.dados, { itens: itens.map(i => ({ itemId: i.id, agendamentoId: i.agendamentoId })) });
    assert.equal(await db.itemComanda.count({ where: { comandaId: primeira.id, agendamentoId: null } }), itens.length);
    const novoInicio = new Date(inicio + 3600000);
    await remarcarPeloCliente(cliente.id, ag.id, novoInicio, undefined, false, itens.reduce((v, i) => v + i.precoUnitCentavos, 0));
    const abertas = await Promise.all([abrir(), abrir(), abrir()]);
    assert.notEqual(abertas[0].id, primeira.id);
    assert.equal(new Set(abertas.map(c => c.id)).size, 1);
    assert.equal(await db.itemComanda.count({ where: { comandaId: abertas[0].id } }), itens.length);
    await assert.rejects(cancelarPeloCliente(cliente.id, ag.id), /já tem comanda/);
    await cancelarComanda(s, abertas[0].id, "Teste de cancelamento");
    await cancelarPeloCliente(cliente.id, ag.id);
    assert.equal(await db.agendamento.count({ where: { clienteId: cliente.id, status: "CANCELADO" } }), itens.length);
    await assert.rejects(abrir(), /cancelado/);
    console.log(grupo ? "Grupo" : "Simples", "OK: histórico, remarcação, três aberturas concorrentes e cancelamento.");
  }

  const cliente = await db.cliente.create({ data: { nome: "Teste antecipado", telefone: randomUUID() } });
  const profissional = await db.barbeiro.create({ data: { nome: "Teste antecipado", usuario: {
    create: { nome: "Teste antecipado", telefone: randomUUID(), papel: "BARBEIRO" },
  } } });
  const ag = await db.agendamento.create({ data: { clienteId: cliente.id, barbeiroId: profissional.id, servicoId: servicos[0].id,
    origem: "SITE", inicio: dia, fim: new Date(+dia + 1800000), precoCentavos: 5000 } });
  const antecipado = await db.pagamentoAntecipado.create({ data: { agendamentoId: ag.id, clienteId: cliente.id,
    valorCentavos: 5000, forma: "PIX", status: "PAGO", pagoEm: new Date() } });
  const c = await abrirComanda(s, { agendamentoId: ag.id });
  const pg = await db.pagamentoComanda.findUniqueOrThrow({ where: { antecipadoId: antecipado.id } });
  assert.equal(pg.comandaId, c.id);
  await assert.rejects(cancelarComanda(s, c.id, "Teste cobrança confirmada"), /pagamentos lançados/);
  await db.pedidoEstorno.create({ data: { comandaId: c.id, tipo: "COMANDA", referenciaId: pg.id, valorCentavos: 5000,
    valorOriginalCentavos: 5000, motivo: "Teste", meio: "SIMULADO", forma: "PIX", descricao: "Teste" } });
  await db.pagamentoComanda.update({ where: { id: pg.id }, data: { status: "CANCELADO", estornadoCentavos: 5000, estornadoEm: new Date() } });
  await cancelarComanda(s, c.id, "Teste de vínculo financeiro");
  assert.equal((await db.itemComanda.findUniqueOrThrow({ where: { agendamentoId: ag.id } })).comandaId, c.id);
  await assert.rejects(abrirComanda(s, { agendamentoId: ag.id }), /comanda cancelada/);
  console.log("Antecipado pago e estorno: vínculo preservado, nova cobrança bloqueada.");
}
main().finally(() => db.$disconnect()).catch(err => { console.error(err); process.exitCode = 1; });
