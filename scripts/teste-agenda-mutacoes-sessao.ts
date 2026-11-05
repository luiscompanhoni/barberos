/** Cancelar/remarcar em voo: só PostgreSQL sintético local, sem provedores ou mensagens. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { cancelarPeloCliente, remarcarPeloCliente } from "@/lib/agenda/cliente";
import { cancelarPedido } from "@/lib/agenda/pedidos";
import { dataLocal, instanteLocal, somarDias } from "@/lib/agenda/tempo";

const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (url.hostname !== "127.0.0.1" || url.port !== "15439" || url.pathname !== "/barberos_cliente_teste_20261104") throw Error("Use apenas o banco sintético local autorizado.");
globalThis.fetch = async () => { throw Error("Rede externa bloqueada no ensaio de agenda."); };
const tag = `testagenda-sessao-${randomUUID()}`;
let usuarioId = "", clienteId = "", barbeiroId = "", barbeiroUsuarioId = "", servicoId = "", checks = 0;
const entrou = Promise.withResolvers<void>(), revogar = Promise.withResolvers<void>();
function ok(c: unknown, mensagem: string) { assert.ok(c, mensagem); checks++; console.log(`OK ${mensagem}`); }
async function esperarFila(chave: string, quantidade: number) {
  const prazo = performance.now() + 8000;
  while (performance.now() < prazo) {
    const r = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND objid::bigint = (hashtext(${chave})::bigint & 4294967295)`;
    if (Number(r[0].n) >= quantidade) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw Error("As mutações não aguardaram a trava de identidade.");
}
async function main() {
  try {
    const cfg = await db.configuracao.findUniqueOrThrow({ where: { id: 1 } });
    assert.equal(cfg.agendaExternaAtiva, true, "A conferência por equipe deve permanecer ativa no teste.");
    const data = somarDias(dataLocal(Date.now(), cfg.fuso), 3), inicio = new Date(instanteLocal(data, 600, cfg.fuso));
    const novoInicio = new Date(instanteLocal(data, 660, cfg.fuso));
    const u = await db.usuario.create({ data: { nome: tag, telefone: `${tag}-u`, papel: "CLIENTE", telefoneVerificadoEm: new Date(), cliente: { create: { nome: tag, telefone: `${tag}-c` } } }, include: { cliente: true } });
    usuarioId = u.id; clienteId = u.cliente!.id;
    const s = await db.servico.create({ data: { nome: tag, duracaoMin: 30, precoCentavos: 5000 } }); servicoId = s.id;
    const b = await db.barbeiro.create({ data: { nome: tag, usuario: { create: { nome: tag, telefone: `${tag}-b`, papel: "BARBEIRO" } }, servicos: { create: { servicoId } } } });
    barbeiroId = b.id; barbeiroUsuarioId = b.usuarioId;
    const ag = await db.agendamento.create({ data: { clienteId, barbeiroId, servicoId, inicio, fim: new Date(+inicio + 1800000), origem: "SITE", precoCentavos: 5000 } });
    const pedido = await db.pedidoAgendamento.create({ data: { clienteId, barbeiroId, servicoIds: [servicoId], dataPreferida: data, horaPreferida: "12:00", chave: randomUUID() } });
    const titular = { usuarioId, sessaoVersao: 0 }, chave = `auth-usuario:${usuarioId}`;
    // Simula a gravação de revogação sob a mesma trava da recuperação de senha.
    const recuperacao = db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chave}))`;
      entrou.resolve(); await revogar.promise;
      await tx.usuario.update({ where: { id: usuarioId }, data: { sessaoVersao: { increment: 1 } } });
    }, { timeout: 15000 });
    await entrou.promise;
    const tentativas = Promise.allSettled([
      cancelarPeloCliente(clienteId, ag.id, titular),
      remarcarPeloCliente(clienteId, ag.id, novoInicio, barbeiroId, false, 5000, titular),
      cancelarPedido(pedido.id, clienteId, usuarioId, 0),
    ]);
    try { await esperarFila(chave, 3); } finally { revogar.resolve(); await recuperacao; }
    const resultados = await tentativas;
    ok(resultados.length === 3 && resultados.every(r => r.status === "rejected" && r.reason?.codigo === "sessao_invalida"), "cancelamento, remarcação e pedido recusam sessões revogadas após aguardar a trava");
    const intacto = await db.agendamento.findUniqueOrThrow({ where: { id: ag.id } });
    ok(intacto.status === "MARCADO" && +intacto.inicio === +inicio && intacto.precoCentavos === 5000, "horário e preço permanecem intactos após requisições antigas");
    ok((await db.pedidoAgendamento.findUniqueOrThrow({ where: { id: pedido.id } })).status === "PENDENTE", "pedido não é cancelado pela sessão antiga");
    ok(await db.auditoria.count({ where: { entidadeId: { in: [ag.id, pedido.id] } } }) === 0, "nenhuma mutação recusada gera auditoria de sucesso");
    const atual = { ...titular, sessaoVersao: 1 };
    ok((await cancelarPedido(pedido.id, clienteId, usuarioId, 1)).status === "CANCELADO", "nova sessão consegue cancelar o próprio pedido");
    await assert.rejects(cancelarPeloCliente(clienteId, ag.id, atual), (e: unknown) => !!e && typeof e === "object" && "codigo" in e && e.codigo === "confirmacao_equipe");
    await assert.rejects(remarcarPeloCliente(clienteId, ag.id, novoInicio, barbeiroId, false, 5000, atual), (e: unknown) => !!e && typeof e === "object" && "codigo" in e && e.codigo === "confirmacao_equipe");
    ok((await db.agendamento.findUniqueOrThrow({ where: { id: ag.id } })).status === "MARCADO", "nova sessão continua sujeita à confirmação Cash Barber, sem reserva ou cancelamento automático");
    console.log(`PASS ${checks} verificações; configuração preservada e nenhum serviço externo.`);
  } finally {
    revogar.resolve();
    if (clienteId) { await db.pedidoAgendamento.deleteMany({ where: { clienteId } }); await db.agendamento.deleteMany({ where: { clienteId } }); await db.cliente.deleteMany({ where: { id: clienteId } }); }
    if (barbeiroId) await db.barbeiro.deleteMany({ where: { id: barbeiroId } });
    if (servicoId) await db.servico.deleteMany({ where: { id: servicoId } });
    await db.usuario.deleteMany({ where: { id: { in: [usuarioId, barbeiroUsuarioId].filter(Boolean) } } });
    await db.$disconnect();
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
