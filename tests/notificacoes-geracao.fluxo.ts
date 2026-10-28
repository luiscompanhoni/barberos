import assert from "node:assert/strict";
import { db } from "../src/lib/db";
import { gerarNotificacoes, notificacaoAindaRelevante } from "../src/lib/notificacoes/geracao";
import { dataLocal, instanteLocal } from "../src/lib/agenda/tempo";

if (new URL(process.env.DATABASE_URL!).pathname !== "/barberos_test_notificacoes_geracao") throw new Error("Use somente barberos_test_notificacoes_geracao.");
const agora = new Date("2027-07-12T12:00:00Z"); // 9h em São Paulo.
const DIA = 86_400_000, MIN = 60_000;
const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let sequencia = 0, checks = 0;
const ok = (valor: unknown, motivo: string) => { assert(valor, motivo); checks++; };

async function pessoa() {
  const chave = `${uid}-${++sequencia}`;
  const u = await db.usuario.create({ data: { nome: `Cliente ${chave}`, telefone: `cliente-${chave}`, papel: "CLIENTE" } });
  const c = await db.cliente.create({ data: { usuarioId: u.id, nome: u.nome, telefone: u.telefone, aceitaMensagens: false } });
  const staff = await db.usuario.create({ data: { nome: `Profissional ${chave}`, telefone: `staff-${chave}`, papel: "BARBEIRO" } });
  const b = await db.barbeiro.create({ data: { nome: staff.nome, usuarioId: staff.id, expediente: { create: Array.from({ length: 7 }, (_, diaSemana) => ({ diaSemana, inicioMin: 540, fimMin: 1080 })) } } });
  return { u, c, staff, b };
}

async function main() {
  await db.configuracao.upsert({ where: { id: 1 }, create: { id: 1, fuso: "America/Sao_Paulo", lembreteHorasAntes: 24, lembreteMinutosAntes: 60 }, update: { fuso: "America/Sao_Paulo", lembreteHorasAntes: 24, lembreteMinutosAntes: 60 } });
  await db.avaliacaoConfig.upsert({ where: { id: 1 }, create: { id: 1, ativo: false }, update: { ativo: false } });
  const servico = await db.servico.create({ data: { nome: `Serviço ${uid}`, duracaoMin: 20, precoCentavos: 5000, intervaloRecompraDias: 10 } });
  const p = await pessoa();
  await db.barbeiroServico.create({ data: { barbeiroId: p.b.id, servicoId: servico.id } });
  const a = await db.agendamento.create({ data: { clienteId: p.c.id, barbeiroId: p.b.id, servicoId: servico.id, inicio: new Date(+agora + 30 * MIN), fim: new Date(+agora + 50 * MIN), criadoEm: new Date(+agora - 3 * 60 * MIN), precoCentavos: 5000, origem: "SITE" } });
  const dois = await Promise.all([gerarNotificacoes(agora, { usuarioIds: [p.u.id] }), gerarNotificacoes(agora, { usuarioIds: [p.u.id] })]);
  ok(dois.every(r => !r.falhas), "Geração concorrente sem falhas");
  let avisos = await db.notificacao.findMany({ where: { usuarioId: p.u.id, categoria: "AGENDA" } });
  ok(avisos.length === 1, "Um aviso de agenda por evento/usuário");
  ok(await notificacaoAindaRelevante(avisos[0], agora), "Aviso próprio ainda relevante");
  ok(!JSON.stringify({ titulo: avisos[0].titulo, corpo: avisos[0].corpo }).includes(servico.nome), "Texto não expõe serviço/nome/preço");
  ok(await db.notificacao.count({ where: { usuarioId: p.staff.id } }) === 0, "Filtro de usuário não inclui equipe de terceiros");
  await db.agendamento.update({ where: { id: a.id }, data: { status: "CANCELADO" } });
  ok(!await notificacaoAindaRelevante(avisos[0], agora), "Cancelamento invalida aviso já persistido");
  ok((await gerarNotificacoes(agora, { clienteIds: [p.c.id] })).criadas === 0, "Cancelado não gera aviso");
  await db.agendamento.update({ where: { id: a.id }, data: { status: "MARCADO", inicio: new Date(+agora + 40 * MIN), fim: new Date(+agora + 60 * MIN) } });
  ok(!await notificacaoAindaRelevante(avisos[0], agora), "Remarcação invalida horário anterior");
  ok((await gerarNotificacoes(agora, { clienteIds: [p.c.id] })).agenda === 1, "Remarcação ainda relevante recebe nova chave");
  avisos = await db.notificacao.findMany({ where: { usuarioId: p.u.id, categoria: "AGENDA" }, orderBy: { id: "desc" } });
  const atual = avisos.find(n => (n.dados as { inicio: string }).inicio === new Date(+agora + 40 * MIN).toISOString())!;
  ok(!await notificacaoAindaRelevante(atual, new Date(+agora + 41 * MIN)), "Atendimento iniciado não gera lembrete atrasado");
  await db.notificacaoPreferencia.update({ where: { usuarioId: p.u.id }, data: { agenda: false } });
  ok(!await notificacaoAindaRelevante(atual, agora), "Revogar categoria remove relevância da central");
  await db.usuario.update({ where: { id: p.u.id }, data: { ativo: false } });
  ok((await gerarNotificacoes(agora, { usuarioIds: [p.u.id] })).usuarios === 0, "Conta desativada não participa do lote");

  const tardio = await pessoa();
  await db.notificacaoPreferencia.create({ data: { usuarioId: tardio.u.id, agenda: false } });
  await db.agendamento.create({ data: { clienteId: tardio.c.id, barbeiroId: tardio.b.id, servicoId: servico.id, inicio: new Date(+agora + 35 * MIN), fim: new Date(+agora + 55 * MIN), criadoEm: new Date(+agora - 3 * 60 * MIN), precoCentavos: 5000, origem: "SITE" } });
  ok((await gerarNotificacoes(agora, { usuarioIds: [tardio.u.id] })).agenda === 0, "Categoria desligada não consome o evento");
  await db.notificacaoPreferencia.update({ where: { usuarioId: tardio.u.id }, data: { agenda: true } });
  ok((await gerarNotificacoes(agora, { usuarioIds: [tardio.u.id] })).agenda === 1, "Opt-in tardio recebe evento ainda útil");

  await db.avaliacaoConfig.update({ where: { id: 1 }, data: { ativo: true, ativaDesde: new Date(+agora - 30 * DIA), validadeDias: 14, whatsapp: false } });
  const avaliacao = await pessoa();
  await db.agendamento.create({ data: { clienteId: avaliacao.c.id, barbeiroId: avaliacao.b.id, servicoId: servico.id, inicio: new Date(+agora - 2 * 60 * MIN), fim: new Date(+agora - 60 * MIN), status: "CONCLUIDO", precoCentavos: 5000, origem: "SITE" } });
  ok((await gerarNotificacoes(agora, { usuarioIds: [avaliacao.u.id] })).avaliacoes === 1, "Primeira visita concluída gera convite no app sem WhatsApp");
  const convite = await db.conviteAvaliacao.findUniqueOrThrow({ where: { clienteId: avaliacao.c.id } });
  const avisoAvaliacao = await db.notificacao.findFirstOrThrow({ where: { usuarioId: avaliacao.u.id, categoria: "AVALIACAO" } });
  await db.conviteAvaliacao.update({ where: { id: convite.id }, data: { respondidaEm: agora } });
  ok(!await notificacaoAindaRelevante(avisoAvaliacao, agora), "Convite respondido deixa de aparecer");
  ok((await gerarNotificacoes(agora, { usuarioIds: [avaliacao.u.id] })).avaliacoes === 0, "Resposta não cria convite repetido");
  const antigo = await pessoa();
  await db.agendamento.create({ data: { clienteId: antigo.c.id, barbeiroId: antigo.b.id, servicoId: servico.id, inicio: new Date(+agora - 21 * DIA - 60 * MIN), fim: new Date(+agora - 21 * DIA), status: "CONCLUIDO", precoCentavos: 5000, origem: "SITE" } });
  ok((await gerarNotificacoes(agora, { usuarioIds: [antigo.u.id] })).avaliacoes === 0, "Opt-in não reenvia avaliação de visita vencida");

  const recompra = await pessoa();
  const compra = await db.agendamento.create({ data: { clienteId: recompra.c.id, barbeiroId: recompra.b.id, servicoId: servico.id, inicio: new Date(+agora - 40 * DIA - 60 * MIN), fim: new Date(+agora - 40 * DIA), status: "CONCLUIDO", precoCentavos: 5000, origem: "SITE" } });
  await db.comanda.create({ data: { clienteId: recompra.c.id, status: "FECHADA", itens: { create: { agendamentoId: compra.id, descricao: "Compra paga", quantidade: 1, precoUnitCentavos: 5000, barbeiroId: recompra.b.id } }, pagamentos: { create: { forma: "PIX", valorCentavos: 5000, status: "PAGO" } } } });
  await db.recompraConfig.upsert({ where: { id: 1 }, create: { id: 1, ativo: true, whatsapp: false, intervaloContatoDias: 7 }, update: { ativo: true, whatsapp: false, intervaloContatoDias: 7 } });
  ok((await gerarNotificacoes(agora, { usuarioIds: [recompra.u.id] })).recompras === 0, "Recompra é desligada por padrão");
  await db.notificacaoPreferencia.update({ where: { usuarioId: recompra.u.id }, data: { recompra: true } });
  const simultaneos = await Promise.all([1, 2].map(() => gerarNotificacoes(agora, { usuarioIds: [recompra.u.id] })));
  ok(simultaneos.reduce((s, r) => s + r.recompras, 0) === 1 && simultaneos.every(r => !r.falhas), "Adesão própria gera um aviso concorrente sem depender de aceitaMensagens/WhatsApp");
  const avisoRecompra = await db.notificacao.findFirstOrThrow({ where: { usuarioId: recompra.u.id, categoria: "RECOMPRA" } });
  ok(await notificacaoAindaRelevante(avisoRecompra, agora), "Compra paga e ciclo devido mantém relevância");
  ok((await gerarNotificacoes(new Date(+agora + DIA), { usuarioIds: [recompra.u.id] })).recompras === 0, "Intervalo evita contatos repetidos no app");
  await db.agendamento.create({ data: { clienteId: recompra.c.id, barbeiroId: recompra.b.id, servicoId: servico.id, inicio: new Date(+agora + DIA), fim: new Date(+agora + DIA + 20 * MIN), precoCentavos: 5000, origem: "SITE" } });
  ok(!await notificacaoAindaRelevante(avisoRecompra, agora), "Recompra já agendada invalida sugestão da central");
  await db.recompraConfig.update({ where: { id: 1 }, data: { ativo: false } });
  ok((await gerarNotificacoes(new Date(+agora + 8 * DIA), { usuarioIds: [recompra.u.id] })).recompras === 0, "Configuração comercial desligada é respeitada");

  const equipe = await pessoa();
  await db.barbeiroServico.create({ data: { barbeiroId: equipe.b.id, servicoId: servico.id } });
  ok((await gerarNotificacoes(agora, { clienteIds: [equipe.c.id] })).equipe === 0, "Filtro de clientes não dispara resumo da equipe");
  ok((await gerarNotificacoes(agora, { usuarioIds: [equipe.staff.id] })).equipe === 1, "Janela real para serviço habilitado gera resumo próprio");
  const avisoEquipe = await db.notificacao.findFirstOrThrow({ where: { usuarioId: equipe.staff.id, categoria: "EQUIPE" } });
  ok(avisoEquipe.href === "/meu-dia" && !avisoEquipe.corpo.includes("R$"), "Resumo aponta Meu dia e não expõe financeiro");
  ok((await gerarNotificacoes(agora, { usuarioIds: [equipe.staff.id] })).equipe === 0, "Uma notificação de equipe por dia");
  const data = dataLocal(agora, "America/Sao_Paulo");
  await db.bloqueio.create({ data: { barbeiroId: equipe.b.id, inicio: new Date(instanteLocal(data, 540, "America/Sao_Paulo")), fim: new Date(instanteLocal(data, 1080, "America/Sao_Paulo")), motivo: "Folga teste" } });
  ok(!await notificacaoAindaRelevante(avisoEquipe, agora), "Agenda toda bloqueada invalida resumo sem atendimentos");
  ok(!await notificacaoAindaRelevante(avisoEquipe, new Date(+agora + DIA)), "Resumo de ontem não é relevante hoje");

  const lote = await Promise.all([pessoa(), pessoa(), pessoa()]);
  const ids = lote.map(x => x.u.id);
  for (let i = 0; i < 3; i++) await gerarNotificacoes(agora, { usuarioIds: ids, limite: 1 });
  ok(await db.notificacaoPreferencia.count({ where: { usuarioId: { in: ids }, ultimoProcessamentoEm: agora } }) === 3, "Lotes limitados alcançam todos os usuários sem starvation");
  ok((await gerarNotificacoes(new Date("2027-07-12T02:00:00Z"), { usuarioIds: ids })).usuarios === 0, "Fuso comercial impede geração noturna");
  ok((await gerarNotificacoes(agora, { clienteIds: [] })).usuarios === 0, "Filtro vazio nunca vira consulta de todos");
  ok(await db.pushEntrega.count() === 0 && await db.mensagem.count() === 0, "Geração isolada não envia push nem WhatsApp");
  console.log(`PASS notificações geração: ${checks} verificações no banco isolado; nenhum envio externo.`);
}
main().finally(() => db.$disconnect());
