/** App direto com agenda externa legada: somente PostgreSQL sintético nominal, sem rede. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { agendarPeloCliente, cancelarPeloCliente, remarcarPeloCliente } from "@/lib/agenda/cliente";
import { horariosDisponiveis } from "@/lib/agenda/consultas";
import { dataLocal, diaSemana, instanteLocal, somarDias } from "@/lib/agenda/tempo";

const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (url.hostname !== "127.0.0.1" || url.port !== "55549" || url.pathname !== "/barberos_anotacoes_teste_20261109") throw Error("Use apenas o banco descartável nominal das anotações.");
globalThis.fetch = async () => { throw Error("Rede externa bloqueada no ensaio de agendamento do app."); };
const tag = `teste-app-${randomUUID()}`;
let checks = 0;
function ok(c: unknown, mensagem: string) { assert.ok(c, mensagem); checks++; console.log(`OK ${mensagem}`); }
const codigo = (esperado: string) => (e: unknown) => !!e && typeof e === "object" && "codigo" in e && e.codigo === esperado;
async function esperarFila(chave: string, n: number) {
  const prazo = performance.now() + 8000;
  while (performance.now() < prazo) {
    const r = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND objid::bigint = (hashtext(${chave})::bigint & 4294967295)`;
    if (Number(r[0].n) >= n) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw Error("As operações não aguardaram a trava de identidade.");
}

async function main() {
  const anterior = await db.configuracao.findUnique({ where: { id: 1 } });
  const valores = { agendaExternaAtiva: true, botAtivo: false, antecedenciaMinimaMin: 0, maxAgendamentosCliente: 20, limiteFaltas: 0 };
  const cfg = await db.configuracao.upsert({ where: { id: 1 }, create: { id: 1, ...valores }, update: valores });
  try {
    const data = somarDias(dataLocal(Date.now(), cfg.fuso), 3), hora = (m: number) => new Date(instanteLocal(data, m, cfg.fuso));
    const usuarios = await Promise.all([1, 2].map(i => db.usuario.create({ data: { nome: `${tag}-${i}`, telefone: `${tag}-u${i}`, papel: "CLIENTE", telefoneVerificadoEm: new Date(), cliente: { create: { nome: `${tag}-${i}`, telefone: `${tag}-c${i}` } } }, include: { cliente: true } })));
    const [corte, barba] = await Promise.all([db.servico.create({ data: { nome: `${tag}-corte`, duracaoMin: 30, precoCentavos: 5000 } }), db.servico.create({ data: { nome: `${tag}-barba`, duracaoMin: 30, precoCentavos: 3000 } })]);
    const b = await db.barbeiro.create({ data: { nome: tag, usuario: { create: { nome: tag, telefone: `${tag}-b`, papel: "BARBEIRO" } }, servicos: { create: [{ servicoId: corte.id }, { servicoId: barba.id }] }, expediente: { create: { diaSemana: diaSemana(data), inicioMin: 480, fimMin: 1200 } } } });
    const identidades = usuarios.map(u => ({ clienteId: u.cliente!.id, usuarioId: u.id, sessaoVersao: 0, nome: u.cliente!.nome, telefone: u.cliente!.telefone }));
    const consulta = { data, barbeiroId: b.id, servicoId: corte.id, servicosAdicionais: [barba.id], paraCliente: true };
    const app = (i: number) => ({ clienteId: identidades[i].clienteId, titular: { usuarioId: identidades[i].usuarioId, sessaoVersao: identidades[i].sessaoVersao } });
    const entrada = (i: number, min: number) => ({ ...identidades[i], barbeiroId: b.id, servicoId: corte.id, servicosAdicionais: [barba.id], origem: "SITE" as const, canalApp: true as const, inicio: hora(min), precoEsperadoCentavos: 8000, duracaoEsperadaMin: 60 });
    const reservar = (i: number, min: number) => agendarPeloCliente(entrada(i, min));
    const pedido = await db.pedidoAgendamento.create({ data: { clienteId: identidades[0].clienteId, barbeiroId: b.id, servicoIds: [corte.id, barba.id], dataPreferida: data, horaPreferida: "10:00", chave: randomUUID() } });

    await assert.rejects(horariosDisponiveis(consulta), codigo("confirmacao_equipe"));
    await assert.rejects(agendarPeloCliente({ ...entrada(0, 600), canalApp: undefined }), codigo("confirmacao_equipe"));
    await assert.rejects(agendarPeloCliente({ ...entrada(0, 600), origem: "BOT", canalApp: undefined }), codigo("confirmacao_equipe"));
    ok(await db.agendamento.count({ where: { clienteId: { in: identidades.map(c => c.clienteId) } } }) === 0, "bot e SITE sem canal interno não reservam durante a transição");
    const [previa] = await horariosDisponiveis({ ...consulta, app: app(0) });
    ok(previa.duracaoMin === 60 && previa.precoCentavos === 8000 && previa.horarios.includes(hora(600).toISOString()), "app autenticado oferece dois serviços com duração e valor integrais");
    await assert.rejects(agendarPeloCliente({ ...entrada(0, 600), duracaoEsperadaMin: 30 }), codigo("duracao_alterada"));
    await assert.rejects(agendarPeloCliente({ ...entrada(0, 600), precoEsperadoCentavos: 7999 }), codigo("preco_alterado"));
    await assert.rejects(agendarPeloCliente({ ...entrada(0, 600), usuarioId: undefined }), codigo("sessao_invalida"));
    await assert.rejects(agendarPeloCliente({ ...entrada(0, 600), usuarioId: identidades[1].usuarioId }), codigo("sessao_invalida"));
    ok(await db.agendamento.count({ where: { clienteId: { in: identidades.map(c => c.clienteId) } } }) === 0, "prévia inválida, identidade trocada e canal sem sessão revertem todo o grupo");

    const corrida = await Promise.allSettled([reservar(0, 600), reservar(1, 600)]);
    const sucesso = corrida.find(r => r.status === "fulfilled");
    assert(sucesso?.status === "fulfilled");
    const ag = sucesso.value, indice = identidades.findIndex(c => c.clienteId === ag.clienteId), titular = app(indice).titular;
    ok(corrida.filter(r => r.status === "fulfilled").length === 1 && corrida.some(r => r.status === "rejected" && r.reason?.codigo === "conflito_horario"), "duas confirmações concorrentes geram exatamente uma reserva");
    const grupo = () => db.agendamento.findMany({ where: { OR: [{ id: ag.id }, { adicionalDeId: ag.id }] }, orderBy: { inicio: "asc" } });
    let itens = await grupo();
    ok(itens.length === 2 && +ag.fim - +ag.inicio === 60 * 60000 && +itens[1].inicio === +hora(630) && itens.reduce((s, i) => s + i.precoCentavos, 0) === 8000, "reserva mantém grupo sequencial, duração total e centavos");
    ok((await db.auditoria.findFirstOrThrow({ where: { entidadeId: ag.id, acao: "criar" } })).usuarioId === titular.usuarioId, "auditoria identifica o usuário autenticado que confirmou");
    const [ocupado] = await horariosDisponiveis({ ...consulta, app: app(indice) });
    ok(!ocupado.horarios.includes(hora(630).toISOString()), "serviços adicionais bloqueiam todo o período ocupado");
    await assert.rejects(cancelarPeloCliente(ag.clienteId, ag.id, titular), codigo("confirmacao_equipe"));
    await assert.rejects(remarcarPeloCliente(ag.clienteId, ag.id, hora(720), b.id, false, 8000, titular, 60), codigo("confirmacao_equipe"));
    const movido = await remarcarPeloCliente(ag.clienteId, ag.id, hora(720), b.id, false, 8000, titular, 60, true);
    itens = await grupo();
    ok(+movido.inicio === +hora(720) && +movido.fim === +hora(780) && +itens[1].inicio === +hora(750), "app remarca todos os serviços em uma transação sem confirmação da equipe");
    await db.servico.update({ where: { id: barba.id }, data: { duracaoMin: 45 } });
    await assert.rejects(remarcarPeloCliente(ag.clienteId, ag.id, hora(840), b.id, false, 8000, titular, 60, true), codigo("duracao_alterada"));
    await db.servico.update({ where: { id: barba.id }, data: { duracaoMin: 30 } });
    ok(+(await db.agendamento.findUniqueOrThrow({ where: { id: ag.id } })).inicio === +hora(720), "remarcação com duração obsoleta preserva o horário anterior");

    const entrou = Promise.withResolvers<void>(), soltar = Promise.withResolvers<void>();
    const chave = `auth-usuario:${titular.usuarioId}`;
    const controle = db.$transaction(async tx => { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chave}))`; entrou.resolve(); await soltar.promise; await tx.usuario.update({ where: { id: titular.usuarioId }, data: { sessaoVersao: { increment: 1 } } }); }, { timeout: 15000 });
    await entrou.promise;
    const auditoriasAntes = await db.auditoria.count({ where: { usuarioId: titular.usuarioId } });
    const tentativas = Promise.allSettled([reservar(indice, 840), remarcarPeloCliente(ag.clienteId, ag.id, hora(840), b.id, false, 8000, titular, 60, true), cancelarPeloCliente(ag.clienteId, ag.id, titular, true)]);
    try { await esperarFila(chave, 3); } finally { soltar.resolve(); await controle; }
    const recusas = await tentativas;
    ok(recusas.every(r => r.status === "rejected" && r.reason?.codigo === "sessao_invalida"), "criar, remarcar e cancelar em espera recusam sessão revogada sob trava");
    ok(await db.auditoria.count({ where: { usuarioId: titular.usuarioId } }) === auditoriasAntes, "operações recusadas não registram sucesso na auditoria");
    await assert.rejects(horariosDisponiveis({ ...consulta, app: app(indice) }), codigo("sessao_invalida"));
    identidades[indice].sessaoVersao = 1;
    const atual = app(indice).titular;
    const comanda = await db.comanda.create({ data: { clienteId: ag.clienteId, itens: { create: { agendamentoId: itens[1].id, descricao: `${tag}-serviço`, precoUnitCentavos: 3000 } } } });
    await assert.rejects(cancelarPeloCliente(ag.clienteId, ag.id, atual, true), codigo("comanda_existente"));
    await assert.rejects(remarcarPeloCliente(ag.clienteId, ag.id, hora(840), b.id, false, 8000, atual, 60, true), /já tem comanda/);
    await db.comanda.delete({ where: { id: comanda.id } }); // Remove somente a comanda fictícia criada acima.
    await cancelarPeloCliente(ag.clienteId, ag.id, atual, true);
    ok((await grupo()).every(a => a.status === "CANCELADO"), "nova sessão cancela o grupo inteiro e comanda protege antes da liberação");
    ok((await db.auditoria.findFirstOrThrow({ where: { entidadeId: ag.id, acao: "cancelar_pelo_cliente" } })).usuarioId === atual.usuarioId, "cancelamento mantém autoria na auditoria transacional");
    ok((await db.pedidoAgendamento.findUniqueOrThrow({ where: { id: pedido.id } })).status === "PENDENTE", "pedidos legados pendentes permanecem sem conversão ou aprovação implícita");
    ok((await db.configuracao.findUniqueOrThrow({ where: { id: 1 } })).agendaExternaAtiva, "exceção do app não desativa a transição do bot no banco");
    console.log(`PASS ${checks} verificações do app direto; dados sintéticos, rede bloqueada e nenhuma operação financeira.`);
  } finally {
    if (anterior) await db.configuracao.update({ where: { id: 1 }, data: { agendaExternaAtiva: anterior.agendaExternaAtiva, botAtivo: anterior.botAtivo, antecedenciaMinimaMin: anterior.antecedenciaMinimaMin, maxAgendamentosCliente: anterior.maxAgendamentosCliente, limiteFaltas: anterior.limiteFaltas } });
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
