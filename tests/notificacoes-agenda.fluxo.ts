/** Banco exclusivo e transporte simulado. Nunca usa dados ou endpoints de pessoas reais. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import webPush from "web-push";
import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { notificarNovoAgendamento } from "@/lib/notificacoes/novo-agendamento";
import { notificacaoAindaRelevante } from "@/lib/notificacoes/geracao-relevancia";
import { gerarNotificacoes } from "@/lib/notificacoes/geracao";
import { salvarInscricaoPush } from "@/lib/notificacoes/inscricoes";
import { processarPush } from "@/lib/notificacoes/envio";
import { publicarNotificacao } from "@/lib/notificacoes/caixa";
import { corpoAtualPush } from "@/lib/notificacoes/texto-atual";

assert.equal(new URL(process.env.DATABASE_URL!).pathname, "/barberos_test_notificacoes_agenda_20261124");
assert.equal(new URL(process.env.DATABASE_URL!).hostname, "127.0.0.1");
const keys = webPush.generateVAPIDKeys();
Object.assign(process.env, { AMBIENTE: "homologacao", PUSH_PROVIDER: "webpush", VAPID_PUBLIC_KEY: keys.publicKey,
  VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: "mailto:teste@example.test", SITE_URL: "https://teste.example.test", PAINEL_URL: "https://teste.example.test" });
webPush.sendNotification = async () => { throw Error("Transporte externo proibido neste teste"); };
const uid = `teste-push-${Date.now()}`;
const inicio = new Date(Date.now() + 2 * 86_400_000); inicio.setUTCHours(12, 30, 0, 0);
const noite = new Date(+inicio - 10 * 3_600_000);
let checks = 0;
function ok(condicao: unknown, descricao: string) { assert(condicao, descricao); checks++; }

async function main() {
  await db.configuracao.upsert({ where: { id: 1 }, create: { id: 1, fuso: "America/Sao_Paulo", lembreteHorasAntes: 24, lembreteMinutosAntes: 90 }, update: { lembreteHorasAntes: 24, lembreteMinutosAntes: 90 } });
  const usuarios = await Promise.all((["DONO", "GERENTE", "BARBEIRO", "BARBEIRO", "CLIENTE"] as const).map((papel, i) =>
    db.usuario.create({ data: { papel, nome: `${papel} ${uid}-${i}`, telefone: `${uid}-${i}` } })));
  const [dono, gerente, profissional, outro, cliente] = usuarios;
  const b = await db.barbeiro.create({ data: { nome: "Profissional da reserva", usuarioId: profissional.id } });
  const b2 = await db.barbeiro.create({ data: { nome: "Outro profissional", usuarioId: outro.id } });
  const c = await db.cliente.create({ data: { nome: "Cliente sintético", telefone: uid, usuarioId: cliente.id, aceitaMensagens: false } });
  const s = await db.servico.create({ data: { nome: "Corte sintético", precoCentavos: 6500, duracaoMin: 30 } });
  for (const u of usuarios) {
    await salvarInscricaoPush({ usuarioId: u.id, papel: u.papel, nome: u.nome } as Sessao, {
      endpoint: `https://fcm.googleapis.com/fcm/send/${uid}-${u.id}`, keys: { p256dh: keys.publicKey, auth: randomBytes(16).toString("base64url") }, nome: "Aparelho sintético",
    }, "https://teste.example.test");
  }
  const ag = await db.agendamento.create({ data: { clienteId: c.id, barbeiroId: b.id, servicoId: s.id,
    inicio, fim: new Date(+inicio + 30 * 60_000), precoCentavos: 6500, origem: "SITE" } });
  await Promise.all([1, 2].map(() => db.$transaction(tx => notificarNovoAgendamento(tx, ag, "America/Sao_Paulo"))));
  const avisos = await db.notificacao.findMany({ where: { chave: `novo-agendamento:${ag.id}`, usuarioId: { in: usuarios.map(u => u.id) } } });
  ok(avisos.length === 3, "Uma reserva concorrente gera exatamente três destinatários distintos");
  ok(avisos.every(n => [dono.id, gerente.id, profissional.id].includes(n.usuarioId)), "Dono, gerente e profissional recebem, outro barbeiro e cliente não recebem aviso de equipe");
  ok(avisos.every(n => n.corpo.includes(c.nome) && n.corpo.includes(s.nome) && n.corpo.includes(b.nome) && n.corpo.includes("09:30")), "Aviso tem cliente, serviço, profissional e horário local");
  const gerenteAviso = avisos.find(n => n.usuarioId === gerente.id)!;
  ok(await notificacaoAindaRelevante(gerenteAviso, noite), "Gerente sem agenda própria pode consultar o novo agendamento");
  await db.usuario.update({ where: { id: gerente.id }, data: { papel: "BARBEIRO" } });
  ok(!await notificacaoAindaRelevante(gerenteAviso, noite), "Perder o papel de gerente retira acesso a agenda de outro profissional");
  const entrega = await processarPush(noite, { notificacaoIds: avisos.map(n => n.id) });
  ok(entrega.simulados === 2 && entrega.cancelados === 1 && entrega.adiados === 0, "Nova reserva é imediata mesmo fora do horário comercial e revalida destinatários");
  ok((await processarPush(noite, { notificacaoIds: avisos.map(n => n.id) })).processados === 0, "Repetir processamento não duplica entregas");

  await db.agendamento.update({ where: { id: ag.id }, data: { inicio: new Date(+inicio + 60_000), fim: new Date(+ag.fim + 60_000) } });
  ok(!await notificacaoAindaRelevante(avisos.find(n => n.usuarioId === dono.id)!, noite), "Remarcar invalida texto anterior também para o dono");
  await db.agendamento.update({ where: { id: ag.id }, data: { inicio, fim: ag.fim } });
  const agoraLembrete = new Date(+inicio - 30 * 60_000);
  ok((await gerarNotificacoes(agoraLembrete, { usuarioIds: [cliente.id] })).agenda === 1, "Lembrete independe de aceitar mensagens no WhatsApp");
  const lembrete = await db.notificacao.findFirstOrThrow({ where: { usuarioId: cliente.id, categoria: "AGENDA" } });
  ok(lembrete.corpo.includes(b.nome) && lembrete.corpo.includes(s.nome) && !lembrete.corpo.includes(c.nome), "Lembrete inclui dados do atendimento, sem identificar o próprio cliente");
  await db.agendamento.update({ where: { id: ag.id }, data: { barbeiroId: b2.id } });
  const corpo = await corpoAtualPush(lembrete, "America/Sao_Paulo");
  ok(corpo?.includes(b2.nome) && !corpo.includes(b.nome), "Fila recarrega o profissional atual antes de enviar");
  await db.agendamento.update({ where: { id: ag.id }, data: { status: "CANCELADO" } });
  ok(!await notificacaoAindaRelevante(lembrete, agoraLembrete), "Cancelamento invalida lembrete");
  ok((await processarPush(agoraLembrete, { notificacaoIds: [lembrete.id] })).cancelados === 1, "Reserva cancelada não entrega lembrete");
  // A abertura às 8h exige aviso às 6h30; geração e fila devem permitir a mesma exceção.
  for (const hora of [8, 9, 10]) {
    const cedo = new Date(+inicio + 86_400_000); cedo.setUTCHours(hora + 3, 0, 0, 0);
    const avisoEm = new Date(+cedo - 90 * 60_000);
    const reserva = await db.agendamento.create({ data: { clienteId: c.id, barbeiroId: b.id, servicoId: s.id,
      inicio: cedo, fim: new Date(+cedo + 30 * 60_000), criadoEm: new Date(+cedo - 2 * 86_400_000), precoCentavos: 6500, origem: "SITE" } });
    ok((await gerarNotificacoes(new Date(+avisoEm - 60_000), { usuarioIds: [cliente.id] })).agenda === 0, `Atendimento ${hora}h não antecipa o aviso de 90 min`);
    ok((await gerarNotificacoes(avisoEm, { usuarioIds: [cliente.id] })).agenda === 1, `Atendimento ${hora}h gera lembrete aos 90 min, inclusive antes das 8h`);
    const n = await db.notificacao.findFirstOrThrow({ where: { usuarioId: cliente.id, categoria: "AGENDA", dados: { path: ["agendamentoId"], equals: reserva.id } } });
    ok(n.corpo.includes(s.nome) && n.corpo.includes(b.nome) && n.corpo.includes(`${String(hora).padStart(2, "0")}:00`), "Texto mantém serviço, profissional e horário local");
    ok((await processarPush(avisoEm, { notificacaoIds: [n.id] })).simulados === 1, `Fila entrega o lembrete ${hora}h sem esperar a janela comercial`);
    ok((await gerarNotificacoes(avisoEm, { usuarioIds: [cliente.id] })).agenda === 0 && (await processarPush(avisoEm, { notificacaoIds: [n.id] })).processados === 0, "Rodada repetida não duplica o lembrete");
    await db.agendamento.update({ where: { id: reserva.id }, data: { status: "CANCELADO" } });
  }
  const vesperaInicio = new Date(+inicio + 3 * 86_400_000); vesperaInicio.setUTCHours(9, 30, 0, 0);
  const vespera = await db.agendamento.create({ data: { clienteId: c.id, barbeiroId: b.id, servicoId: s.id, inicio: vesperaInicio,
    fim: new Date(+vesperaInicio + 30 * 60_000), criadoEm: new Date(+vesperaInicio - 3 * 86_400_000), precoCentavos: 6500, origem: "SITE" } });
  ok((await gerarNotificacoes(new Date(+vesperaInicio - 86_400_000), { usuarioIds: [cliente.id] })).criadas === 0, "Aviso de véspera continua sem geração noturna");
  const vesperaEm = new Date(+vesperaInicio - 86_400_000);
  const nVespera = await publicarNotificacao({ usuarioId: cliente.id, categoria: "AGENDA", chave: `teste-vespera:${vespera.id}`,
    titulo: "Lembrete do seu atendimento", corpo: "Corte sintético", href: "/c", criadoEm: vesperaEm, expiraEm: vesperaInicio,
    dados: { agendamentoId: vespera.id, inicio: vesperaInicio.toISOString(), tipo: "LEMBRETE_VESPERA" } });
  ok(!!nVespera && (await processarPush(vesperaEm, { notificacaoIds: [nVespera.id] })).adiados === 1, "Fila de véspera continua aguardando 8h");
  const canceladoInicio = new Date(+inicio + 4 * 86_400_000); canceladoInicio.setUTCHours(11, 0, 0, 0);
  const canceladoEm = new Date(+canceladoInicio - 90 * 60_000);
  const cancelado = await db.agendamento.create({ data: { clienteId: c.id, barbeiroId: b.id, servicoId: s.id, inicio: canceladoInicio,
    fim: new Date(+canceladoInicio + 30 * 60_000), criadoEm: new Date(+canceladoInicio - 2 * 86_400_000), precoCentavos: 6500, origem: "SITE" } });
  await db.notificacaoPreferencia.update({ where: { usuarioId: cliente.id }, data: { agenda: false } });
  ok((await gerarNotificacoes(canceladoEm, { usuarioIds: [cliente.id] })).agenda === 0, "Revogação de agenda é respeitada também às 6h30");
  await db.notificacaoPreferencia.update({ where: { usuarioId: cliente.id }, data: { agenda: true } });
  ok((await gerarNotificacoes(canceladoEm, { usuarioIds: [cliente.id] })).agenda === 1, "Adesão permite o lembrete próximo às 6h30");
  const nCancelado = await db.notificacao.findFirstOrThrow({ where: { usuarioId: cliente.id, dados: { path: ["agendamentoId"], equals: cancelado.id } } });
  await db.agendamento.update({ where: { id: cancelado.id }, data: { status: "CANCELADO" } });
  ok((await processarPush(canceladoEm, { notificacaoIds: [nCancelado.id] })).cancelados === 1, "Cancelamento antes da entrega bloqueia push também fora do horário comercial");
  ok(await db.mensagem.count() === 0, "Nenhuma mensagem de WhatsApp criada");
  console.log(`PASS agenda push: ${checks} verificações em banco sintético, nenhum envio externo.`);
}
main().finally(() => db.$disconnect());
