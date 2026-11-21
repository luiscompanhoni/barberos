import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { alterarStatus, criarAgendamento } from "@/lib/agenda/agendamentos";
import { configuracao } from "@/lib/agenda/carregar";
import { lembrarHorarios } from "@/lib/automacoes/lembrar-horarios";
import { rodarAutomacoes } from "@/lib/automacoes/rotina";
import { receberMensagem } from "@/lib/bot/processar";
import { db } from "@/lib/db";
import { jogar, jogarPelaCampanha } from "@/lib/jogos/motor";
import { HORA, NUDGE_ROLETA, POS_ROLETA, UPSELL_ROLETA, registrarEntradaJornadaRoleta } from "@/lib/jogos/jornada-roleta";
import { registrarAbandonosRoleta, rodarNudgesRoleta, rodarPosRoleta } from "@/lib/jogos/jornada-roleta-rotina";
import { obterConversa, registrarEntrada } from "@/lib/whatsapp/conversas";

const habilitado = process.env.TESTE_JORNADA_ROLETA_LOCAL === "1";
if (habilitado) {
  const banco = new URL(process.env.DATABASE_URL ?? "");
  if (!["127.0.0.1", "localhost"].includes(banco.hostname) || !/^\/leonel_\w+_teste$/.test(banco.pathname)) {
    throw new Error("Use somente um banco descartável local da trilha.");
  }
}

async function cliente() {
  const telefone = "5531" + randomInt(900000000, 1000000000);
  return db.cliente.create({ data: { nome: "Marcos Teste", telefone, aceitaMensagens: true } });
}

async function girar(clienteId: string, tipo: "BRINDE" | "CREDITO" | "NADA" = "CREDITO") {
  const jogo = await db.jogo.create({ data: { id: randomUUID(), nome: "Roleta teste", tipo: "ROLETA", ativo: true } });
  await db.jogoPremio.create({ data: {
    jogoId: jogo.id, tipo, chanceBps: 10000, rotulo: "Prêmio teste", cor: "#aa9900", valorCentavos: 1500,
  } });
  const ficha = await db.fichaJogo.create({ data: { jogoId: jogo.id, clienteId, origem: "MANUAL", referencia: randomUUID() } });
  const chave = randomUUID();
  const obtida = await jogar(clienteId, jogo.id, chave, { fichaId: ficha.id, ip: null });
  const repetida = await jogar(clienteId, jogo.id, chave, { fichaId: ficha.id, ip: null });
  expect(repetida.id).toBe(obtida.id);
  return obtida.id;
}

async function prepararAgendamento(clienteId: string, inicio: Date, premioId?: string) {
  const dono = await db.usuario.create({ data: { telefone: randomUUID(), nome: "Dono Teste", papel: "DONO" } });
  const usuario = await db.usuario.create({ data: { telefone: randomUUID(), nome: "Beto Teste", papel: "BARBEIRO" } });
  const barbeiro = await db.barbeiro.create({ data: { nome: usuario.nome, usuarioId: usuario.id } });
  const servico = await db.servico.create({ data: { nome: "Corte", duracaoMin: 30, precoCentavos: 5000 } });
  await db.barbeiroServico.create({ data: { barbeiroId: barbeiro.id, servicoId: servico.id } });
  await db.expedientePadrao.createMany({ data: Array.from({ length: 7 }, (_, diaSemana) => ({
    barbeiroId: barbeiro.id, diaSemana, inicioMin: 480, fimMin: 1260,
  })) });
  const ator = { usuarioId: dono.id, nome: dono.nome, papel: dono.papel, barbeiroId: null, clienteId: null };
  const agendamento = await criarAgendamento({
    cliente: { id: clienteId }, origem: "RECEPCAO", barbeiroId: barbeiro.id, servicoId: servico.id, inicio, premioId,
  }, ator);
  return { agendamento, ator };
}

const lerJornada = (jogadaId: string) => db.jornadaRoleta.findUniqueOrThrow({ where: { jogadaId } });
async function envelhecerGiro(jogadaId: string) {
  const instante = new Date(Date.now() - 5 * HORA);
  await db.jornadaRoleta.update({ where: { jogadaId }, data: { ganhouEm: instante, girouEm: instante } });
}
async function falas(telefone: string) {
  return (await db.mensagem.findMany({ where: { conversa: { telefone }, autor: "SISTEMA", erro: null },
    orderBy: [{ criadoEm: "asc" }, { id: "asc" }], select: { texto: true } })).map(m => m.texto);
}

describe.skipIf(!habilitado)("jornada da roleta com PostgreSQL e WhatsApp simulado", () => {
  beforeAll(async () => {
    // Mantém a rodada perto do meio-dia local, sem depender da hora de execução.
    const offset = new Date().getUTCHours() - 12;
    const fuso = offset === 0 ? "UTC" : `Etc/GMT${offset > 0 ? "+" : ""}${offset}`;
    await db.configuracao.upsert({ where: { id: 1 }, create: { id: 1, fuso }, update: {
      fuso, botAtivo: true, lembreteHorasAntes: 0, lembreteMinutosAntes: 90, posAtendimento: false,
    } });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Rede bloqueada no teste")));
  });
  beforeEach(() => {
    vi.stubEnv("AMBIENTE", "homologacao");
    vi.stubEnv("WHATSAPP_PROVIDER", "simulador");
    vi.stubEnv("WHATSAPP_ROLETA_NUDGE_HORAS", "4");
    vi.stubEnv("SITE_URL", "https://black.exemplo.test");
    for (const flag of ["BARBEROS_QUARENTENA_RESTAURACAO", "WHATSAPP_ENVIOS_BLOQUEADOS", "WHATSAPP_PILOTO_ENTREVISTAS_HABILITADO",
      "WHATSAPP_ATENDIMENTO_TESTE_EQUIPE", "WHATSAPP_ATENDIMENTO_IA_PAGA", "WHATSAPP_ATENDIMENTO_APOS_PILOTO", "RECRUTAMENTO_ENTREVISTAS_WHATSAPP_ATIVO",
      "WHATSAPP_ROLETA_ACOMPANHAMENTO_ATIVO", "WHATSAPP_ROLETA_UPSELL_ATIVO"]) vi.stubEnv(flag, "false");
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await db.$disconnect();
  });

  it.each(["CREDITO", "NADA"] as const)("registra o giro e o resultado %s uma única vez", async tipo => {
    const c = await cliente();
    const jogadaId = await girar(c.id, tipo);
    const jornada = await lerJornada(jogadaId);
    expect(jornada.clienteId).toBe(c.id);
    expect(jornada.girouEm).toBeInstanceOf(Date);
    if (tipo === "CREDITO") expect(jornada.ganhouEm).toEqual(jornada.girouEm);
    else expect(jornada.ganhouEm).toBeNull();
  });

  it("conta a validade do giro de campanha a partir da continuação", async () => {
    const c = await cliente(), jogoId = randomUUID(), token = randomUUID();
    const jogo = await db.jogo.create({ data: { id: jogoId, nome: "Roleta teste", tipo: "ROLETA", ativo: true, validadeDias: 1 } });
    await db.jogoPremio.create({ data: { jogoId, tipo: "BRINDE", rotulo: "Brinde teste", cor: "#aa9900", chanceBps: 10000 } });
    const campanha = await db.campanha.create({ data: { nome: "Teste", mensagem: "Oi! {link}", segmentos: ["frio"], limiteDiario: 1, jogoId } });
    const agora = Date.now();
    const abertura = new Date(agora - 48 * HORA), oferta = new Date(agora - HORA);
    await db.campanhaEnvio.create({ data: {
      campanhaId: campanha.id, clienteId: c.id, status: "ENVIADO", token, lote: 1,
      aberturaIniciadaEm: abertura, enviadoEm: abertura, continuacaoReservadaEm: oferta, ofertaEnviadaEm: oferta,
    } });
    const r = await jogarPelaCampanha(token, { ip: null });
    expect(r.jogada.vitoria).toBe(true);
    expect(await lerJornada(r.jogada.id)).toMatchObject({ clienteId: c.id, ganhouEm: expect.any(Date) });
    const ficha = await db.fichaJogo.findUniqueOrThrow({ where: { jogadaId: r.jogada.id } });
    expect(ficha.expiraEm).toEqual(new Date(+oferta + jogo.validadeDias * 24 * HORA));
  });

  it("mede abandono com a trilha desligada, sem enviar nem reservar tentativa", async () => {
    const c = await cliente();
    const jogadaId = await girar(c.id);
    await envelhecerGiro(jogadaId);
    vi.stubEnv("WHATSAPP_ENVIOS_BLOQUEADOS", "true");
    await rodarAutomacoes(Date.now(), { clienteIds: [c.id] });
    expect(await lerJornada(jogadaId)).toMatchObject({ semContinuidadeEm: expect.any(Date), nudgeTentadoEm: null, nudgeEnviadoEm: null });
    expect(await falas(c.telefone)).toEqual([]);
  });

  it("manda um nudge concorrente por cliente e não atribui resposta a um aviso mais novo", async () => {
    vi.stubEnv("WHATSAPP_ROLETA_ACOMPANHAMENTO_ATIVO", "true");
    const c = await cliente();
    const ids = [await girar(c.id), await girar(c.id)];
    for (const id of ids) await envelhecerGiro(id);
    const cfg = await configuracao(), agora = Date.now(), opcoes = { clienteIds: [c.id] };
    await registrarAbandonosRoleta(agora, opcoes);
    const rodadas = await Promise.all([rodarNudgesRoleta(agora, cfg, opcoes), rodarNudgesRoleta(agora, cfg, opcoes)]);
    expect(rodadas.sort()).toEqual([0, 1]);
    expect(await falas(c.telefone)).toEqual([NUDGE_ROLETA]);
    const conversa = await obterConversa(c.telefone);
    await db.mensagem.create({ data: { conversaId: conversa.id, autor: "SISTEMA", texto: "Outro lembrete confirmado." } });
    const resposta = (await registrarEntrada({ telefone: c.telefone, texto: "Sim", wamid: randomUUID() }))!;
    expect(await registrarEntradaJornadaRoleta(resposta, "Sim", false)).toBeNull();
    expect(await db.jornadaRoleta.count({ where: { clienteId: c.id, respondeuEm: { not: null } } })).toBe(0);
  });

  it.each(["fora do horário", "cloud fora da janela", "opt-out", "humano", "bloqueio", "piloto"])("não tenta contato com %s", async motivo => {
    vi.stubEnv("WHATSAPP_ROLETA_ACOMPANHAMENTO_ATIVO", "true");
    const c = await cliente();
    const jogadaId = await girar(c.id);
    await envelhecerGiro(jogadaId);
    const cfg = await configuracao(), agora = Date.now(), opcoes = { clienteIds: [c.id] };
    await registrarAbandonosRoleta(agora, opcoes);
    if (motivo === "cloud fora da janela") {
      vi.stubEnv("AMBIENTE", "teste");
      vi.stubEnv("WHATSAPP_PROVIDER", "cloud");
    }
    if (motivo === "opt-out") await registrarEntrada({ telefone: c.telefone, texto: "Não quero mais", optOut: true });
    if (motivo === "humano") {
      const { id } = await obterConversa(c.telefone);
      await db.conversa.update({ where: { id }, data: { estado: "HUMANO" } });
    }
    if (motivo === "bloqueio") vi.stubEnv("WHATSAPP_ENVIOS_BLOQUEADOS", "true");
    if (motivo === "piloto") vi.stubEnv("WHATSAPP_PILOTO_ENTREVISTAS_HABILITADO", "true");
    expect(await rodarNudgesRoleta(agora + (motivo === "fora do horário" ? 12 * HORA : 0), cfg, opcoes)).toBe(0);
    expect(await lerJornada(jogadaId)).toMatchObject({ nudgeTentadoEm: null, nudgeEnviadoEm: null });
  });

  it("não repete nudge que saiu sem confirmação do provedor", async () => {
    vi.stubEnv("WHATSAPP_ROLETA_ACOMPANHAMENTO_ATIVO", "true");
    vi.stubEnv("AMBIENTE", "teste");
    vi.stubEnv("WHATSAPP_PROVIDER", "evolution");
    vi.stubEnv("EVOLUTION_URL", "https://whatsapp.invalid");
    vi.stubEnv("EVOLUTION_API_KEY", "fixture");
    const c = await cliente();
    const jogadaId = await girar(c.id);
    await envelhecerGiro(jogadaId);
    const cfg = await configuracao(), agora = Date.now(), opcoes = { clienteIds: [c.id] };
    await registrarAbandonosRoleta(agora, opcoes);
    expect(await rodarNudgesRoleta(agora, cfg, opcoes)).toBe(0);
    expect(await lerJornada(jogadaId)).toMatchObject({ nudgeTentadoEm: expect.any(Date), nudgeEnviadoEm: null });
    vi.stubEnv("AMBIENTE", "homologacao");
    expect(await rodarNudgesRoleta(Date.now(), cfg, opcoes)).toBe(0);
    expect(await db.mensagem.count({ where: { conversa: { telefone: c.telefone }, texto: NUDGE_ROLETA } })).toBe(1);
  });

  it("vincula o prêmio certo ao horário e mede lembrete, visita, agradecimento e aceite", async () => {
    vi.stubEnv("WHATSAPP_ROLETA_ACOMPANHAMENTO_ATIVO", "true");
    const c = await cliente();
    const jogadaId = await girar(c.id, "BRINDE");
    const premio = await db.premioGanho.findFirstOrThrow({ where: { jogadaId } });
    await envelhecerGiro(jogadaId);
    const cfg = await configuracao(), agora = Date.now(), opcoes = { clienteIds: [c.id] };
    await registrarAbandonosRoleta(agora, opcoes);
    expect(await rodarNudgesRoleta(agora, cfg, opcoes)).toBe(1);
    const resposta = { telefone: c.telefone, texto: "Pode mandar!", wamid: randomUUID() };
    const modelo = { criar: vi.fn().mockRejectedValue(new Error("A continuação direta não precisa de IA.")) };
    await receberMensagem(resposta, { modelo });
    await receberMensagem(resposta, { modelo });
    const doBot = await db.mensagem.findMany({ where: { conversa: { telefone: c.telefone }, autor: "BOT", erro: null },
      select: { texto: true } });
    expect(doBot).toEqual([{ texto: expect.stringContaining(`https://black.exemplo.test/c/agendar?premio=${premio.id}`) }]);
    expect(modelo.criar).not.toHaveBeenCalled();
    const outroGiro = await girar(c.id);
    const { agendamento: a, ator } = await prepararAgendamento(c.id, new Date(agora + HORA), premio.id);
    expect(await lerJornada(jogadaId)).toMatchObject({ agendamentoId: a.id, agendouEm: expect.any(Date), respondeuEm: expect.any(Date) });
    expect(await lerJornada(outroGiro)).toMatchObject({ agendamentoId: null });
    await db.agendamento.update({ where: { id: a.id }, data: { criadoEm: new Date(agora - HORA) } });
    expect(await lembrarHorarios(Date.now(), cfg, [c.id], false)).toBe(1);
    expect(await lembrarHorarios(Date.now(), cfg, [c.id], false)).toBe(0);
    const chegada = await alterarStatus(a.id, "CHEGOU", ator);
    const conclusao = await alterarStatus(a.id, "CONCLUIDO", ator);
    expect(await lerJornada(jogadaId)).toMatchObject({ compareceuEm: chegada.atualizadoEm, concluiuEm: conclusao.atualizadoEm, lembreteEnviadoEm: expect.any(Date) });
    const posCorte = +conclusao.atualizadoEm + HORA;
    expect(await rodarPosRoleta(posCorte, cfg, opcoes)).toEqual({ pos: 1, upsell: 0 });
    expect(await rodarPosRoleta(posCorte, cfg, opcoes)).toEqual({ pos: 0, upsell: 0 });
    expect(await falas(c.telefone)).toEqual([NUDGE_ROLETA, expect.stringContaining("*SIM*"), POS_ROLETA]);
    vi.stubEnv("WHATSAPP_ROLETA_UPSELL_ATIVO", "true");
    expect(await rodarPosRoleta(posCorte, cfg, opcoes)).toEqual({ pos: 0, upsell: 1 });
    expect(await falas(c.telefone)).toEqual([NUDGE_ROLETA, expect.stringContaining("*SIM*"), POS_ROLETA, UPSELL_ROLETA]);
    const sim = (await registrarEntrada({ telefone: c.telefone, texto: "Sim", wamid: randomUUID() }))!;
    expect(await registrarEntradaJornadaRoleta(sim, "Só queria saber o valor", false)).toBeNull();
    await receberMensagem({ telefone: c.telefone, texto: "Sim, pode marcar!", wamid: randomUUID() }, { modelo });
    expect(await lerJornada(jogadaId)).toMatchObject({ posEnviadoEm: expect.any(Date), upsellEnviadoEm: expect.any(Date), upsellAceitoEm: expect.any(Date) });
    expect(await obterConversa(c.telefone)).toMatchObject({ estado: "HUMANO" });
    expect(await db.mensagem.findFirst({ where: { conversa: { telefone: c.telefone }, autor: "NOTA" }, select: { texto: true } }))
      .toMatchObject({ texto: expect.stringContaining("próximo corte") });
    expect((await falas(c.telefone)).every(t => !/\bvocê\b/i.test(t))).toBe(true);
  });

  it("reserva direta de um ganhador filtra abandono sem exigir nudge", async () => {
    const c = await cliente();
    const jogadaId = await girar(c.id);
    await envelhecerGiro(jogadaId);
    const { agendamento } = await prepararAgendamento(c.id, new Date(Date.now() + HORA));
    await registrarAbandonosRoleta(Date.now(), { clienteIds: [c.id] });
    expect(await lerJornada(jogadaId)).toMatchObject({ agendamentoId: agendamento.id, agendouEm: expect.any(Date), semContinuidadeEm: null });
  });

  it("atribui ao novo horário com prêmio quando o anterior ainda era só inferência", async () => {
    const c = await cliente();
    const jogadaId = await girar(c.id, "BRINDE");
    const { agendamento: a } = await prepararAgendamento(c.id, new Date(Date.now() + HORA));
    expect((await lerJornada(jogadaId)).agendamentoId).toBe(a.id);
    const premio = await db.premioGanho.findFirstOrThrow({ where: { jogadaId } });
    const { agendamento: b } = await prepararAgendamento(c.id, new Date(Date.now() + 2 * HORA), premio.id);
    expect(await lerJornada(jogadaId)).toMatchObject({ agendamentoId: b.id, agendouEm: b.criadoEm });
  });

  it.each([false, true])("trilha desligada mede lembrete de rotina ou convite (convite=%s) e pós nativo", async convite => {
    const c = await cliente(), agora = Date.now();
    const jogadaId = await girar(c.id);
    if (convite) {
      vi.stubEnv("WHATSAPP_ATENDIMENTO_APOS_PILOTO", "true");
      const conversa = await obterConversa(c.telefone);
      const link = await db.mensagem.create({ data: {
        conversaId: conversa.id, autor: "BOT", texto: "fixture", criadoEm: new Date(agora - 2 * HORA),
      } });
      await db.jornadaConviteApp.create({ data: { conversaId: conversa.id, clienteId: c.id, token: randomUUID(), linkId: link.id } });
    }
    const { agendamento: a, ator } = await prepararAgendamento(c.id, new Date(agora + HORA));
    await db.agendamento.update({ where: { id: a.id }, data: { criadoEm: new Date(agora - HORA) } });
    expect(await lembrarHorarios(agora, await configuracao(), [c.id], convite)).toBe(1);
    expect((await lerJornada(jogadaId)).lembreteEnviadoEm).toBeInstanceOf(Date);
    await alterarStatus(a.id, "CONCLUIDO", ator);
    await db.configuracao.update({ where: { id: 1 }, data: { posAtendimento: true } });
    try {
      const rodada = await rodarAutomacoes(+a.fim + HORA, { clienteIds: [c.id] });
      expect(rodada.pos).toBe(1);
      expect(await lerJornada(jogadaId)).toMatchObject({ posEnviadoEm: expect.any(Date), nudgeEnviadoEm: null, upsellEnviadoEm: null });
      expect(await falas(c.telefone)).toEqual([expect.stringContaining("*SIM*"), expect.stringContaining("Valeu pela visita")]);
    } finally {
      await db.configuracao.update({ where: { id: 1 }, data: { posAtendimento: false } });
    }
  });

  it("respeita atraso configurado e pedido que a equipe ainda está conferindo", async () => {
    const c = await cliente();
    const jogadaId = await girar(c.id);
    await envelhecerGiro(jogadaId);
    const agora = Date.now(), opcoes = { clienteIds: [c.id] };
    vi.stubEnv("WHATSAPP_ROLETA_NUDGE_HORAS", "8");
    await registrarAbandonosRoleta(agora, opcoes);
    expect((await lerJornada(jogadaId)).semContinuidadeEm).toBeNull();
    const p = await db.pedidoAgendamento.create({ data: {
      clienteId: c.id, servicoIds: [], chave: randomUUID(), dataPreferida: "2030-01-03", horaPreferida: "12:00",
    } });
    vi.stubEnv("WHATSAPP_ROLETA_NUDGE_HORAS", "1");
    await registrarAbandonosRoleta(agora, opcoes);
    expect((await lerJornada(jogadaId)).semContinuidadeEm).toBeNull();
    await db.pedidoAgendamento.update({ where: { id: p.id }, data: { status: "CANCELADO" } });
    await registrarAbandonosRoleta(agora, opcoes);
    expect((await lerJornada(jogadaId)).semContinuidadeEm).toEqual(new Date(agora));
  });

  it("não manda novo agradecimento se o mesmo corte já teve pós-atendimento", async () => {
    const c = await cliente();
    const jogadaId = await girar(c.id);
    const { agendamento, ator } = await prepararAgendamento(c.id, new Date(Date.now() + HORA));
    const ag = await alterarStatus(agendamento.id, "CONCLUIDO", ator);
    await db.automacaoEnviada.create({ data: {
      tipo: "POS_ATENDIMENTO", clienteId: c.id, agendamentoId: ag.id, chave: `${c.id}:2030-01-02`,
    } });
    vi.stubEnv("WHATSAPP_ROLETA_ACOMPANHAMENTO_ATIVO", "true");
    const rodada = await rodarPosRoleta(+ag.atualizadoEm + HORA, await configuracao(), { clienteIds: [c.id] });
    expect(rodada).toEqual({ pos: 0, upsell: 0 });
    expect((await lerJornada(jogadaId)).posEnviadoEm).toBeNull();
    expect(await falas(c.telefone)).toEqual([]);
  });
});
