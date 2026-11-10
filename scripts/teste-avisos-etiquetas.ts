/** Fluxos reais exclusivamente no banco nominal descartável; nenhuma rede externa. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { db } from "@/lib/db";
import { gerarHash } from "@/lib/auth/senha";
import { entrarNaEspera, esperasDoCliente, opcoesDoDia, sairDaEspera } from "@/lib/crescimento/espera";
import { processarEsperas } from "@/lib/crescimento/rotina";
import { consultarEtiquetasServico, salvarEtiquetasServico } from "@/lib/servicos/etiquetas-servico";
import { dataLocal, somarDias } from "@/lib/agenda/tempo";
import type { AgendaApp } from "@/lib/agenda/transicao";

const url = new URL(process.env.DATABASE_URL ?? "http://invalido");
if (url.hostname !== "127.0.0.1" || url.port !== "55561" || url.pathname !== "/barberos_avisos_etiquetas_teste_20261110" ||
  process.env.WHATSAPP_ENVIOS_BLOQUEADOS !== "true" || process.env.PAGAMENTOS_PROVIDER !== "simulado") {
  throw Error("Use apenas o banco nominal local 55561 e os provedores bloqueados/simulados.");
}
globalThis.fetch = async () => { throw Error("Rede externa bloqueada neste teste."); };
let checks = 0;
function ok(v: unknown, mensagem: string) { assert.ok(v, mensagem); checks++; console.log(`OK ${mensagem}`); }
async function rejeita(acao: Promise<unknown>, codigo: string) {
  await assert.rejects(acao, (e: unknown) => !!e && typeof e === "object" && "codigo" in e && e.codigo === codigo); checks++;
}

async function main() {
  await db.configuracao.upsert({ where: { id: 1 }, create: { id: 1, nomeBarbearia: "Black · TESTE LOCAL", fuso: "America/Sao_Paulo", agendaExternaAtiva: true, botAtivo: false },
    update: { agendaExternaAtiva: true, botAtivo: false, intervaloEntreClientes: 0, antecedenciaMinimaMin: 0 } });
  const senhaHash = await gerarHash("Teste-Avisos-2026!");
  const telefoneBase = `55119${Date.now().toString().slice(-7)}`;
  const dono = await db.usuario.create({ data: { nome: "Dono fictício", telefone: `${telefoneBase}1`, papel: "DONO", senhaHash } });
  const usuario = await db.usuario.create({ data: { nome: "Cliente fictício", telefone: `${telefoneBase}2`, papel: "CLIENTE", senhaHash } });
  const cliente = await db.cliente.create({ data: { nome: usuario.nome, telefone: usuario.telefone, usuarioId: usuario.id, aceitaMensagens: false } });
  const outro = await db.cliente.create({ data: { nome: "Outro fictício", telefone: `${telefoneBase}3`, aceitaMensagens: false } });
  const principal = await db.servico.create({ data: { nome: "Corte de cabelo", duracaoMin: 40, precoCentavos: 6500 } });
  const adicional = await db.servico.create({ data: { nome: "Barba", duracaoMin: 20, precoCentavos: 5000 } });
  const profissional = await db.barbeiro.create({ data: { nome: "Profissional fictício", usuario: { create: { nome: "Barbeiro fictício", telefone: `${telefoneBase}4`, papel: "BARBEIRO", senhaHash } },
    servicos: { create: [{ servicoId: principal.id }, { servicoId: adicional.id }] },
    expediente: { create: Array.from({ length: 7 }, (_, diaSemana) => ({ diaSemana, inicioMin: 540, fimMin: 585 })) } } });
  const semAdicional = await db.barbeiro.create({ data: { nome: "Só corte", usuario: { create: { nome: "Outro barbeiro fictício", telefone: `${telefoneBase}5`, papel: "BARBEIRO" } }, servicos: { create: [{ servicoId: principal.id }] } } });
  const app: AgendaApp = { clienteId: cliente.id, titular: { usuarioId: usuario.id, sessaoVersao: usuario.sessaoVersao } };
  const data = somarDias(dataLocal(Date.now(), "America/Sao_Paulo"), 2);
  const base = { data, servicoId: principal.id, servicosAdicionais: [adicional.id], barbeiroId: profissional.id, periodo: "MANHA" as const, origem: "SITE" as const };
  ok((await opcoesDoDia(data, principal.id, profissional.id, "MANHA", [], { app })).length > 0, "o serviço isolado cabe no expediente");
  ok((await opcoesDoDia(data, principal.id, profissional.id, "MANHA", [adicional.id], { app })).length === 0, "o conjunto inteiro precisa caber na vaga");
  await rejeita(entrarNaEspera(cliente.id, base, app), "avisos_desativados");
  ok(await db.esperaHorario.count({ where: { clienteId: cliente.id } }) === 0, "recusa de mensagens não cria aviso nem reativa preferência");
  await db.cliente.update({ where: { id: cliente.id }, data: { aceitaMensagens: true } });
  const pedidos = await Promise.all(Array.from({ length: 4 }, () => entrarNaEspera(cliente.id, base, app)));
  ok(new Set(pedidos.map(p => p.id)).size === 1 && await db.esperaHorario.count({ where: { clienteId: cliente.id } }) === 1, "pedidos concorrentes não duplicam a espera");
  const pedido = pedidos[0];
  const invertido = await entrarNaEspera(cliente.id, { ...base, servicoId: adicional.id, servicosAdicionais: [principal.id] }, app);
  ok(invertido.id === pedido.id, "ordem dos cliques não duplica o conjunto");
  ok(await db.auditoria.count({ where: { entidade: "espera_horario", entidadeId: pedido.id, acao: "criar", usuarioId: usuario.id } }) === 1, "criação auditada uma vez com o titular real");
  const salvo = (await esperasDoCliente(cliente.id)).find(p => p.id === pedido.id)!;
  ok(salvo.periodo === "MANHA" && [salvo.servicoId, ...salvo.servicosAdicionais].sort().join() === [principal.id, adicional.id].sort().join(), "período e todos os serviços são preservados");
  await rejeita(entrarNaEspera(cliente.id, base, { ...app, titular: { ...app.titular, sessaoVersao: usuario.sessaoVersao + 1 } }), "sessao_invalida");
  await assert.rejects(entrarNaEspera(cliente.id, { ...base, barbeiroId: semAdicional.id }, app)); checks++;
  await assert.rejects(sairDaEspera(outro.id, pedido.id)); checks++;
  await assert.rejects(entrarNaEspera(cliente.id, { ...base, servicosAdicionais: [principal.id] }, app)); checks++;
  const mais = await Promise.allSettled(["TARDE", "NOITE", "QUALQUER"].map(periodo => entrarNaEspera(cliente.id, { ...base, periodo: periodo as "TARDE" | "NOITE" | "QUALQUER" }, app)));
  ok(mais.filter(r => r.status === "fulfilled").length === 2 && await db.esperaHorario.count({ where: { clienteId: cliente.id, status: "ATIVA" } }) === 3, "limite por cliente resiste à concorrência");
  for (const extra of mais) if (extra.status === "fulfilled") await sairDaEspera(cliente.id, extra.value.id, app);
  // Libera uma vaga real para o conjunto, sem alterar a política externa do bot.
  await db.expedientePadrao.updateMany({ where: { barbeiroId: profissional.id }, data: { fimMin: 600 } });
  ok((await opcoesDoDia(data, pedido.servicoId, profissional.id, "MANHA", pedido.servicosAdicionais, { esperaId: pedido.id })).length > 0, "consulta interna comprova espera SITE sem relaxar reserva");
  await rejeita(opcoesDoDia(data, pedido.servicoId, profissional.id, "MANHA", [], { esperaId: pedido.id }), "nao_encontrado");
  const mensagensAntes = await db.mensagem.count(), automacoesAntes = await db.automacaoEnviada.count();
  await processarEsperas(Date.now(), { clienteIds: [cliente.id] });
  ok((await db.esperaHorario.findUniqueOrThrow({ where: { id: pedido.id } })).status === "ATIVA" && await db.mensagem.count() === mensagensAntes && await db.automacaoEnviada.count() === automacoesAntes, "envios bloqueados não consomem aviso nem criam mensagem");
  await sairDaEspera(cliente.id, pedido.id, app); await sairDaEspera(cliente.id, pedido.id, app);
  ok(await db.auditoria.count({ where: { entidadeId: pedido.id, acao: "cancelar" } }) === 1, "cancelamento idempotente auditado uma vez");

  const inicial = await consultarEtiquetasServico(principal.id);
  ok(inicial.versao === 0 && inicial.etiquetas.length === 0, "serviço inicia sem etiqueta");
  const etiqueta = { texto: "DESTAQUE", cor: "#F9CB30", formato: "PILULA" as const };
  const concorrentes = await Promise.allSettled([salvarEtiquetasServico(principal.id, dono.id, { versao: 0, etiquetas: [etiqueta] }),
    salvarEtiquetasServico(principal.id, dono.id, { versao: 0, etiquetas: [{ ...etiqueta, texto: "PREFERIDO" }] })]);
  ok(concorrentes.filter(r => r.status === "fulfilled").length === 1, "uma única edição de etiquetas vence a versão concorrente");
  const conflito = concorrentes.find(r => r.status === "rejected");
  ok(conflito?.status === "rejected" && conflito.reason.codigo === "etiquetas_desatualizadas", "outro editor recebe conflito explícito");
  let atual = await consultarEtiquetasServico(principal.id);
  ok(atual.versao === 1 && await db.auditoria.count({ where: { entidadeId: principal.id, acao: "alterar_etiquetas" } }) === 1, "etiqueta e auditoria são gravadas juntas");
  atual = await salvarEtiquetasServico(principal.id, dono.id, { versao: atual.versao, etiquetas: [{ texto: "EDITÁVEL", cor: "#123456", formato: "RETANGULAR" }] });
  ok(atual.etiquetas[0].formato === "RETANGULAR" && atual.etiquetas[0].cor === "#123456", "texto, cor e formato podem ser reeditados");
  atual = await salvarEtiquetasServico(principal.id, dono.id, { versao: atual.versao, etiquetas: [] });
  ok(atual.etiquetas.length === 0, "remoção de etiqueta preserva o serviço");
  atual = await salvarEtiquetasServico(principal.id, dono.id, { versao: atual.versao, etiquetas: [etiqueta] });
  const final = await db.servico.findUniqueOrThrow({ where: { id: principal.id } });
  ok(final.precoCentavos === principal.precoCentavos && final.duracaoMin === principal.duracaoMin && final.ativo === principal.ativo, "etiquetas não alteram preço, duração nem atividade");
  await assert.rejects(salvarEtiquetasServico(principal.id, dono.id, { versao: atual.versao, etiquetas: [{ ...etiqueta, cor: "url(javascript:erro)" }] })); checks++;
  ok((await consultarEtiquetasServico(principal.id)).versao === atual.versao, "entrada inválida não avança versão");
  await db.$executeRaw`ALTER TABLE auditoria ADD CONSTRAINT teste_avisos_etiquetas_rejeita_auditoria CHECK (acao <> 'alterar_etiquetas') NOT VALID`;
  try {
    await assert.rejects(salvarEtiquetasServico(principal.id, dono.id, { versao: atual.versao, etiquetas: [{ ...etiqueta, texto: "NÃO PERSISTIR" }] })); checks++;
    const rollback = await consultarEtiquetasServico(principal.id);
    ok(rollback.versao === atual.versao && JSON.stringify(rollback.etiquetas) === JSON.stringify(atual.etiquetas), "falha real da auditoria reverte etiqueta e versão");
  } finally {
    await db.$executeRaw`ALTER TABLE auditoria DROP CONSTRAINT teste_avisos_etiquetas_rejeita_auditoria`;
  }
  await assert.rejects(db.$executeRaw`UPDATE servicos SET etiquetas='{}'::jsonb WHERE id=${principal.id}`); checks++;
  await assert.rejects(db.$executeRaw`UPDATE esperas_horario SET "servicosAdicionais"=ARRAY['1','2','3','4','5','6','7','8','9','10']::text[] WHERE id=${pedido.id}`); checks++;
  // Mantém um dia sem vaga para conferir o aviso no navegador local.
  await db.expedientePadrao.updateMany({ where: { barbeiroId: profissional.id }, data: { fimMin: 585 } });
  const prova = { concluido: true, checks, banco: url.pathname.slice(1), porta: 55561, data, principalId: principal.id, adicionalId: adicional.id,
    profissionalId: profissional.id, clienteId: cliente.id, donoId: dono.id, etiquetasVersao: atual.versao, enviosCriados: 0,
    loginsFicticios: { dono: dono.telefone, cliente: usuario.telefone }, apenasDadosFicticios: true };
  if (process.env.AVISOS_ETIQUETAS_PROVA) writeFileSync(process.env.AVISOS_ETIQUETAS_PROVA, JSON.stringify(prova, null, 2), { flag: "wx" });
  console.log(JSON.stringify(prova));
}
main().finally(() => db.$disconnect()).catch(e => { console.error(e); process.exitCode = 1; });
