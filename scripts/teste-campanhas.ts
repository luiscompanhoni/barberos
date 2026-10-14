// Teste de integracao das campanhas (segmentos, lotes, limite diario, quem pula, resultado) contra o banco de
// DESENVOLVIMENTO, com o WhatsApp em modo simulador. Usa datas em 2031 e so os clientes que cria.
// Rodar: npm run teste:campanhas
process.env.WHATSAPP_PROVIDER = "simulador";

import type { Sessao } from "@/lib/auth/sessao";
import { capacidadeDaAgenda } from "@/lib/campanhas/capacidade";
import { criarCampanha, liberarLote, listarCampanhas, mudarStatus, processarCampanhas } from "@/lib/campanhas/servico";
import { db } from "@/lib/db";

const ok = (c: boolean, msg: string) => { console.log(`${c ? "OK  " : "FALHOU"} ${msg}`); if (!c) process.exitCode = 1; };
const falha = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e) { return e as Error & { codigo?: string }; } };
const D = 86_400_000;
const agora = Date.UTC(2031, 2, 5, 15, 0); // quarta 05/03/2031 12:00 em Brasilia
const TELS = ["5511966660001", "5511966660002", "5511966660003", "5511966660004", "5511966660005"];
const TAG = "[teste campanhas]";

async function limpar() {
  const cs = await db.cliente.findMany({ where: { telefone: { in: TELS } }, select: { id: true } });
  const ids = cs.map((c) => c.id);
  await db.campanha.deleteMany({ where: { nome: { startsWith: TAG } } });
  await db.agendamento.deleteMany({ where: { clienteId: { in: ids } } });
  await db.assinatura.deleteMany({ where: { clienteId: { in: ids } } });
  const conversas = await db.conversa.findMany({ where: { telefone: { in: TELS } }, select: { id: true } });
  await db.mensagem.deleteMany({ where: { conversaId: { in: conversas.map((c) => c.id) } } });
  await db.conversa.deleteMany({ where: { telefone: { in: TELS } } });
  await db.cliente.deleteMany({ where: { id: { in: ids } } });
}

async function main() {
  await limpar();
  const dono = await db.usuario.findFirstOrThrow({ where: { papel: "DONO" } });
  const s: Sessao = { usuarioId: dono.id, papel: "DONO", nome: dono.nome, barbeiroId: null, clienteId: null };
  const barbeiro = await db.barbeiro.findFirstOrThrow({ where: { ativo: true } });
  const servico = await db.servico.findFirstOrThrow({ where: { ativo: true } });
  const plano = await db.plano.findFirstOrThrow();
  try {
    const cliente = (tel: string, nome: string, aceitaMensagens = true) => db.cliente.create({ data: { telefone: tel, nome, aceitaMensagens } });
    const visita = (clienteId: string, quando: number, status: "CONCLUIDO" | "MARCADO" = "CONCLUIDO") => db.agendamento.create({
      data: { clienteId, barbeiroId: barbeiro.id, servicoId: servico.id, inicio: new Date(quando), fim: new Date(quando + 30 * 60_000), status, origem: "PAINEL", precoCentavos: 5000 },
    });
    const a = await cliente(TELS[0], `Ana Recente ${TAG}`);
    await visita(a.id, agora - 10 * D);
    const b = await cliente(TELS[1], `Bruno Quarenta ${TAG}`);
    await visita(b.id, agora - 45 * D);
    await db.assinatura.create({ data: { clienteId: b.id, planoId: plano.id, status: "ATIVA", formaPagamento: "PIX", precoCentavos: 9900, origem: "PAINEL" } });
    const c = await cliente(TELS[2], `Caio Sumido ${TAG}`);
    await visita(c.id, agora - 100 * D);
    const d = await cliente(TELS[3], `Davi Marcado ${TAG}`);
    await visita(d.id, agora - 20 * D);
    await visita(d.id, agora + 2 * D, "MARCADO");
    const e = await cliente(TELS[4], `Eva Parou ${TAG}`, false);
    await visita(e.id, agora - 5 * D);
    const todos = [a.id, b.id, c.id, d.id, e.id];
    const naFila = async (campanhaId: string) => (await db.campanhaEnvio.findMany({ where: { campanhaId } })).map((x) => x.clienteId).sort();

    // ================= LOTE: SO QUEM PODE RECEBER, NOS SEGMENTOS
    const base = { mensagem: "Oi, {nome}! A {barbearia} abriu horários: {link}", limiteDiario: 1, taxaRespostaBps: 2000 };
    const c60 = await criarCampanha(s, { ...base, nome: `${TAG} últimos 60 dias`, segmentos: ["ate30", "d31a60"] });
    const l1 = await liberarLote(s, c60.id, 1, agora, { clienteIds: todos });
    ok(l1.lote === 1 && l1.quantidade === 1 && (await naFila(c60.id))[0] === a.id, "lote 1 de 1: o mais recente primeiro (Ana, 10 dias)");
    const l2 = await liberarLote(s, c60.id, 50, agora, { clienteIds: todos });
    ok(l2.lote === 2 && l2.quantidade === 1 && (await naFila(c60.id)).join() === [a.id, b.id].sort().join(), "lote 2: só o Bruno (fora: 100 dias, quem tem horário marcado e quem pediu PARAR)");
    ok((await falha(() => liberarLote(s, c60.id, 10, agora, { clienteIds: todos })))?.codigo === "sem_elegiveis", "ninguém mais para chamar: avisa");

    const cAss = await criarCampanha(s, { ...base, nome: `${TAG} assinantes`, segmentos: ["assinante"] });
    await liberarLote(s, cAss.id, 50, agora, { clienteIds: todos });
    ok((await naFila(cAss.id)).join() === b.id, "segmento assinante: só quem tem assinatura ativa");
    const cPerd = await criarCampanha(s, { ...base, nome: `${TAG} perdidos`, segmentos: ["perdido"] });
    await liberarLote(s, cPerd.id, 50, agora, { clienteIds: todos });
    ok((await naFila(cPerd.id)).join() === c.id, "segmento perdido: mais de 90 dias sem vir");
    await mudarStatus(s, cAss.id, "encerrar");
    await mudarStatus(s, cPerd.id, "encerrar");
    ok((await db.campanhaEnvio.count({ where: { campanhaId: { in: [cAss.id, cPerd.id] }, status: "PULADO" } })) === 2, "encerrar: quem estava na fila não recebe");

    // ================= ENVIO COM LIMITE DIARIO
    ok((await processarCampanhas(agora, { clienteIds: todos })) === 1, "limite 1/dia: sai uma mensagem");
    ok((await processarCampanhas(agora + 60_000, { clienteIds: todos })) === 0, "no mesmo dia não sai mais nenhuma");
    const conversaA = await db.conversa.findFirst({ where: { telefone: TELS[0] }, include: { mensagens: true } });
    const texto = conversaA?.mensagens[0]?.texto ?? "";
    ok(texto.startsWith("Oi, Ana!") && texto.includes("/c/agendar") && texto.includes("responda PARAR"), "mensagem com o primeiro nome, o link e como parar");

    await db.cliente.update({ where: { id: b.id }, data: { aceitaMensagens: false } });
    ok((await processarCampanhas(agora + D, { clienteIds: todos })) === 0, "no dia seguinte: quem pediu PARAR depois do lote é pulado");
    ok((await db.campanhaEnvio.findFirst({ where: { campanhaId: c60.id, clienteId: b.id } }))?.status === "PULADO", "fica como PULADO, com o motivo");

    // ================= PAUSA E RESULTADO
    await mudarStatus(s, c60.id, "pausar");
    ok((await falha(() => liberarLote(s, c60.id, 1, agora, { clienteIds: todos })))?.message.includes("Retome") === true, "pausada não libera lote");
    await mudarStatus(s, c60.id, "retomar");
    await db.agendamento.create({
      data: { clienteId: a.id, barbeiroId: barbeiro.id, servicoId: servico.id, inicio: new Date(agora + 3 * D), fim: new Date(agora + 3 * D + 30 * 60_000), status: "MARCADO", origem: "SITE", precoCentavos: 5000, criadoEm: new Date(agora + 2 * 3_600_000) },
    });
    const r = (await listarCampanhas(agora)).find((x) => x.id === c60.id)!;
    ok(r.enviados === 1 && r.marcaram === 1 && r.pulados === 1 && r.fila === 0 && r.enviadosHoje === 1, "resultado: 1 enviado, 1 marcou depois, 1 pulado");

    // ================= DUAS RODADAS AO MESMO TEMPO NAO MANDAM DUAS VEZES
    await db.cliente.update({ where: { id: b.id }, data: { aceitaMensagens: true } });
    const cDup = await criarCampanha(s, { ...base, limiteDiario: 50, nome: `${TAG} duplo`, segmentos: ["d31a60"] });
    await liberarLote(s, cDup.id, 10, agora, { clienteIds: todos });
    const [x, y] = await Promise.all([processarCampanhas(agora + 2 * D, { clienteIds: todos }), processarCampanhas(agora + 2 * D, { clienteIds: todos })]);
    const conversaB = await db.conversa.findFirst({ where: { telefone: TELS[1] }, include: { mensagens: true } });
    ok(x + y === 1 && conversaB?.mensagens.length === 1, "duas rodadas juntas: o Bruno recebe uma vez só");

    // ================= CAPACIDADE (estrutura)
    const cap = await capacidadeDaAgenda();
    const [h3, h7, h14] = cap.horizontes;
    ok(h3.dias === 3 && h7.dias === 7 && h14.dias === 14 && h3.vagas <= h7.vagas && h7.vagas <= h14.vagas, "capacidade: 3 ≤ 7 ≤ 14 dias");
    ok(h7.porBarbeiro.reduce((t, b) => t + b.vagas, 0) === h7.vagas, "capacidade: total = soma dos barbeiros");
  } finally {
    await limpar();
  }
  console.log(process.exitCode ? "\nAlgum teste FALHOU." : "\nTodos os testes passaram.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
