/** PostgreSQL sintético exclusivo, sem portas públicas nem transporte externo. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { Papel } from "@prisma/client";
import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { fecharAgenda, reabrirAgenda } from "@/lib/agenda/expediente";
import { validarEncaixe } from "@/lib/agenda/agendamentos";
import { assinar } from "@/lib/eventos";
assert.equal(new URL(process.env.DATABASE_URL!).hostname, "127.0.0.1");
assert.equal(new URL(process.env.DATABASE_URL!).pathname, "/barberos_test_reabrir_bloqueios");
Object.assign(process.env, { AMBIENTE: "homologacao", PUSH_PROVIDER: "simulado", WHATSAPP_ENVIOS_BLOQUEADOS: "true", BARBEROS_QUARENTENA_RESTAURACAO: "false" });
const chave = randomBytes(8).toString("hex");let checks = 0;
const ok = (v: unknown, msg: string) => { assert(v, msg);checks++; };
async function pessoa(papel: Papel, sufixo: string): Promise<Sessao> {
  const u = await db.usuario.create({ data: { papel, nome: `Teste ${papel}`, telefone: `bloqueio-${chave}-${sufixo}` } });
  const b = papel === "BARBEIRO" ? await db.barbeiro.create({ data: { usuarioId: u.id, nome: u.nome,
    expediente: { create: Array.from({ length: 7 }, (_, diaSemana) => ({ diaSemana, inicioMin: 480, fimMin: 1200 })) } } }) : null;
  return { usuarioId: u.id, papel, nome: u.nome, barbeiroId: b?.id ?? null, clienteId: null };
}
async function main() {
  await db.configuracao.upsert({ where: { id: 1 }, create: { id: 1, fuso: "America/Sao_Paulo" }, update: { fuso: "America/Sao_Paulo" } });
  const [dono, gerente, recepcao, barbeiro, outro, cliente] = await Promise.all([
    pessoa("DONO", "dono"), pessoa("GERENTE", "gerente"), pessoa("RECEPCAO", "recepcao"), pessoa("BARBEIRO", "proprio"), pessoa("BARBEIRO", "outro"), pessoa("CLIENTE", "cliente"),
  ]);
  const inicio = new Date(Date.now() + 3 * 86_400_000);inicio.setUTCHours(13, 0, 0, 0);
  const fim = new Date(+inicio + 30 * 60_000), barbeiroId = barbeiro.barbeiroId!;
  const cfg = await db.configuracao.findUniqueOrThrow({ where: { id: 1 } });
  const validar = () => db.$transaction(tx => validarEncaixe(tx, barbeiroId, { inicio: +inicio, fim: +fim }, { fuso: cfg.fuso, intervaloEntreClientes: cfg.intervaloEntreClientes }));
  const fechar = () => fecharAgenda(barbeiroId, { inicio, fim, motivo: "Teste de reabertura", confirmar: true }, recepcao);
  const c = await db.cliente.create({ data: { usuarioId: cliente.usuarioId, nome: cliente.nome, telefone: `cliente-${chave}`, aceitaMensagens: false } });
  const servico = await db.servico.create({ data: { nome: "Serviço teste", duracaoMin: 30, precoCentavos: 6500 } });
  const ag = await db.agendamento.create({ data: { clienteId: c.id, barbeiroId, servicoId: servico.id, origem: "SITE", inicio: new Date(+inicio + 2 * 3_600_000), fim: new Date(+fim + 2 * 3_600_000), precoCentavos: 6500 } });
  for (const ator of [dono, gerente, recepcao, barbeiro]) {
    const r = await fechar();assert(r.criado);
    await assert.rejects(validar(), { codigo: "agenda_fechada" });checks++;
    const eventos: unknown[] = [];const sair = assinar(e => eventos.push(e));
    try { await reabrirAgenda(r.bloqueio.id, ator); } finally { sair(); }
    ok(await db.bloqueio.count({ where: { id: r.bloqueio.id } }) === 0, `${ator.papel} remove o bloqueio`);
    ok(await db.auditoria.count({ where: { entidadeId: r.bloqueio.id, acao: "reabrir_agenda", usuarioId: ator.usuarioId } }) === 1, "Auditoria identifica quem reabriu");
    assert.deepEqual(eventos, [{ tipo: "agenda", barbeiroIds: [barbeiroId], datas: [] }]);checks++;
    await validar();checks++;
  }
  const protegido = await fechar();assert(protegido.criado);
  for (const ator of [outro, cliente]) { await assert.rejects(reabrirAgenda(protegido.bloqueio.id, ator), { status: 403 });checks++; }
  await db.permissaoUsuario.create({ data: { usuarioId: recepcao.usuarioId, permissao: "bloquear_agenda", permitido: false } });
  await assert.rejects(reabrirAgenda(protegido.bloqueio.id, recepcao), { status: 403 });checks++;
  ok(await db.bloqueio.count({ where: { id: protegido.bloqueio.id } }) === 1, "Acesso recusado preserva o bloqueio");
  const concorrentes = await Promise.allSettled([reabrirAgenda(protegido.bloqueio.id, dono), reabrirAgenda(protegido.bloqueio.id, gerente)]);
  ok(concorrentes.filter(r => r.status === "fulfilled").length === 1, "Apenas uma remoção concorrente conclui");
  ok(concorrentes.filter(r => r.status === "rejected" && r.reason.status === 404).length === 1, "Segunda remoção informa 404 em vez de erro interno");
  ok(await db.auditoria.count({ where: { entidadeId: protegido.bloqueio.id, acao: "reabrir_agenda" } }) === 1, "Sem auditoria duplicada");
  await assert.rejects(reabrirAgenda("entrevista:teste", dono), { status: 404 });checks++;
  const intacto = await db.agendamento.findUniqueOrThrow({ where: { id: ag.id } });
  ok(intacto.status === "MARCADO" && +intacto.inicio === +ag.inicio && +intacto.fim === +ag.fim, "Atendimento existente não é alterado nem recriado");
  ok(await db.mensagem.count() === 0 && await db.comanda.count() === 0, "Nenhum envio ou comanda no teste");
  console.log(`PASS reabrir bloqueios: ${checks} verificações no banco sintético; quatro perfis, limites de acesso, disponibilidade, auditoria, SSE e concorrência.`);
}
main().finally(() => db.$disconnect());
