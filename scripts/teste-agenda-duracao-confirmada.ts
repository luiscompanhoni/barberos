/** Prévia de duração obsoleta: banco sintético local, sem provedores ou mensagens. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { agendarPeloCliente, remarcarPeloCliente } from "@/lib/agenda/cliente";
import { horariosDisponiveis } from "@/lib/agenda/consultas";
import { dataLocal, diaSemana, instanteLocal, somarDias } from "@/lib/agenda/tempo";

const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (url.hostname !== "127.0.0.1" || url.port !== "15439" || url.pathname !== "/barberos_cliente_teste_20261104") throw Error("Use apenas o banco sintético local autorizado.");
globalThis.fetch = async () => { throw Error("Rede externa bloqueada no ensaio de duração."); };
const tag = `testagenda-duracao-${randomUUID()}`;
let clienteId = "", usuarioId = "", barbeiroId = "", barbeiroUsuarioId = "", checks = 0;
let externaAnterior: boolean | undefined;
const servicoIds: string[] = [];
function ok(c: unknown, mensagem: string) { assert.ok(c, mensagem); checks++; console.log(`OK ${mensagem}`); }
const codigo = (esperado: string) => (e: unknown) => !!e && typeof e === "object" && "codigo" in e && e.codigo === esperado;
async function esperarFila(chave: string) {
  const prazo = performance.now() + 8000;
  while (performance.now() < prazo) {
    const r = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND objid::bigint = (hashtext(${chave})::bigint & 4294967295)`;
    if (Number(r[0].n) > 0) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw Error("A remarcação não aguardou a trava de identidade.");
}
async function main() {
  try {
    const cfg = await db.configuracao.findUniqueOrThrow({ where: { id: 1 } });
    externaAnterior = cfg.agendaExternaAtiva;
    await db.configuracao.update({ where: { id: 1 }, data: { agendaExternaAtiva: false } });
    const data = somarDias(dataLocal(Date.now(), cfg.fuso), 3);
    const hora = (min: number) => new Date(instanteLocal(data, min, cfg.fuso));
    const u = await db.usuario.create({ data: { nome: tag, telefone: `${tag}-u`, papel: "CLIENTE", telefoneVerificadoEm: new Date(), cliente: { create: { nome: tag, telefone: `${tag}-c` } } }, include: { cliente: true } });
    usuarioId = u.id; clienteId = u.cliente!.id;
    const corte = await db.servico.create({ data: { nome: `${tag}-corte`, duracaoMin: 30, precoCentavos: 5000 } }); servicoIds.push(corte.id);
    const barba = await db.servico.create({ data: { nome: `${tag}-barba`, duracaoMin: 20, precoCentavos: 3000 } }); servicoIds.push(barba.id);
    const b = await db.barbeiro.create({ data: { nome: tag, usuario: { create: { nome: tag, telefone: `${tag}-b`, papel: "BARBEIRO" } },
      servicos: { create: servicoIds.map(servicoId => ({ servicoId })) }, expediente: { create: { diaSemana: diaSemana(data), inicioMin: 480, fimMin: 1200 } } } });
    barbeiroId = b.id; barbeiroUsuarioId = b.usuarioId;
    const titular = { usuarioId, sessaoVersao: 0 };
    const consulta = { data, barbeiroId, servicoId: corte.id, servicosAdicionais: [barba.id], paraCliente: true };
    const [previa] = await horariosDisponiveis(consulta);
    ok(previa.duracaoMin === 50 && previa.precoCentavos === 8000 && previa.horarios.includes(hora(600).toISOString()), "resumo original oferece corte e barba por 50 minutos e R$80");
    const reservar = (duracaoEsperadaMin: number) => agendarPeloCliente({ ...titular, clienteId, nome: tag, telefone: u.cliente!.telefone,
      barbeiroId, servicoId: corte.id, servicosAdicionais: [barba.id], origem: "SITE", inicio: hora(600), precoEsperadoCentavos: 8000, duracaoEsperadaMin });
    await db.servico.update({ where: { id: corte.id }, data: { duracaoMin: 45 } });
    await assert.rejects(reservar(previa.duracaoMin), codigo("duracao_alterada"));
    ok(await db.agendamento.count({ where: { clienteId } }) === 0, "criação recusa duração antiga sem persistir nenhum item");
    const [novaPrevia] = await horariosDisponiveis(consulta);
    const ag = await reservar(novaPrevia.duracaoMin);
    const grupo = () => db.agendamento.findMany({ where: { clienteId }, orderBy: { inicio: "asc" } });
    let itens = await grupo();
    ok(novaPrevia.duracaoMin === 65 && +ag.fim - +ag.inicio === 65 * 60000, "nova confirmação aceita exatamente a duração atualizada");
    ok(itens.length === 2 && itens.reduce((s, x) => s + x.precoCentavos, 0) === 8000, "criação preserva dois serviços e o preço total");
    const antes = itens.map(x => ({ id: x.id, inicio: +x.inicio, fim: +x.fim, preco: x.precoCentavos }));
    const auditoriaAntes = await db.auditoria.count({ where: { entidadeId: ag.id } });
    await db.servico.update({ where: { id: barba.id }, data: { duracaoMin: 35 } });
    await assert.rejects(remarcarPeloCliente(clienteId, ag.id, hora(780), barbeiroId, false, 8000, titular, novaPrevia.duracaoMin), codigo("duracao_alterada"));
    itens = await grupo();
    assert.deepEqual(itens.map(x => ({ id: x.id, inicio: +x.inicio, fim: +x.fim, preco: x.precoCentavos })), antes);
    ok(await db.auditoria.count({ where: { entidadeId: ag.id } }) === auditoriaAntes, "remarcação obsoleta preserva grupo e não audita sucesso");
    const [previaRemarcar] = await horariosDisponiveis({ ...consulta, ignorarAgendamentoId: ag.id });
    const movido = await remarcarPeloCliente(clienteId, ag.id, hora(780), barbeiroId, false, 8000, titular, previaRemarcar.duracaoMin);
    itens = await grupo();
    ok(previaRemarcar.duracaoMin === 80 && +movido.fim - +movido.inicio === 80 * 60000, "remarcação aceita o novo resumo de 80 minutos");
    ok(itens.every(x => antes.some(a => a.id === x.id)) && itens.reduce((s, x) => s + x.precoCentavos, 0) === 8000, "remarcação mantém os IDs e o valor de ambos os serviços");

    // A duração também pode mudar após os snapshots, enquanto a mutação espera uma trava.
    const entrou = Promise.withResolvers<void>(), soltar = Promise.withResolvers<void>();
    const chave = `auth-usuario:${usuarioId}`;
    const bloqueio = db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chave}))`;
      entrou.resolve(); await soltar.promise;
    }, { timeout: 15000 });
    await entrou.promise;
    const tentativa = Promise.allSettled([remarcarPeloCliente(clienteId, ag.id, hora(960), barbeiroId, false, 8000, titular, 80)]);
    try {
      await esperarFila(chave);
      await db.servico.update({ where: { id: barba.id }, data: { duracaoMin: 40 } });
    } finally { soltar.resolve(); await bloqueio; }
    ok((await tentativa)[0].status === "rejected", "mudança concorrente do adicional durante a espera também é recusada");
    const mantido = await db.agendamento.findUniqueOrThrow({ where: { id: ag.id } });
    ok(+mantido.inicio === +movido.inicio && +mantido.fim === +movido.fim, "conflito durante a transação não desloca nem estende o horário");
    console.log(`PASS ${checks} verificações de duração; preço preservado e nenhuma chamada externa.`);
  } finally {
    try {
      if (clienteId) { await db.agendamento.deleteMany({ where: { clienteId } }); await db.cliente.deleteMany({ where: { id: clienteId } }); }
      if (barbeiroId) await db.barbeiro.deleteMany({ where: { id: barbeiroId } });
      await db.servico.deleteMany({ where: { id: { in: servicoIds } } });
      await db.usuario.deleteMany({ where: { id: { in: [usuarioId, barbeiroUsuarioId].filter(Boolean) } } });
    } finally {
      if (externaAnterior !== undefined) await db.configuracao.update({ where: { id: 1 }, data: { agendaExternaAtiva: externaAnterior } });
      await db.$disconnect();
    }
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
