import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Modelo } from "@/lib/bot/agente";
import { NextRequest } from "next/server";
import { POST as visita } from "@/app/api/convite-app/visita/route";
import { rodarRetomadas } from "@/lib/convites/retomadas";
import { lembrarHorarios } from "@/lib/automacoes/lembrar-horarios";
import { relatorioConvites } from "@/lib/convites/relatorio";
import { receberMensagem } from "@/lib/bot/processar";
import { db } from "@/lib/db";
import { obterConversa } from "@/lib/whatsapp/conversas";
import { avisarReservaPeloApp } from "@/lib/convites/confirmar";
import { idModeloSegmento } from "@/lib/campanhas/modelos-segmento";
import { jogarPelaCampanha } from "@/lib/jogos/motor";
import { landingDaCampanha } from "@/lib/campanhas/link";
import { iniciarConviteApp } from "@/lib/whatsapp/convite-app";

const { sessao } = vi.hoisted(() => ({ sessao: vi.fn(async () => null as { papel: string; clienteId: string } | null) }));
vi.mock("@/lib/auth/sessao", async original => ({ ...await original<typeof import("@/lib/auth/sessao")>(), sessaoAtual: sessao }));
const habilitado = process.env.TESTE_CONVITE_APP_LOCAL === "1";
if (habilitado) {
  const banco = new URL(process.env.DATABASE_URL ?? "");
  if (!["127.0.0.1", "localhost"].includes(banco.hostname) || !banco.pathname.includes("teste")) {
    throw new Error("Use um banco de testes local descartável.");
  }
}

let gestorId: string;
const site = "https://black.exemplo.test";
const abertura = ["Fala, João!", "Aqui é o Leonel da Black."];
async function contato() {
  const telefone = "55479" + randomInt(10000000, 99999999);
  await db.cliente.create({ data: { nome: "João Teste", telefone, aceitaMensagens: true } });
  return obterConversa(telefone);
}
async function falas(id: string) {
  const mensagens = await db.mensagem.findMany({ where: { conversaId: id, autor: "BOT" },
    orderBy: [{ criadoEm: "asc" }, { id: "asc" }], select: { texto: true, erro: true } });
  expect(mensagens.every(m => !m.erro)).toBe(true);
  return mensagens.map(m => m.texto);
}
const etapa = (id: string) => db.conversa.findUniqueOrThrow({ where: { id }, select: { conviteApp: true, estado: true, recusaAutomaticas: true } });

async function visitaConcluida(clienteId: string, diasAtras: number) {
  const u = await db.usuario.create({ data: { nome: "Barbeiro visitante", telefone: randomUUID(), papel: "BARBEIRO" } });
  const barbeiro = await db.barbeiro.create({ data: { nome: "Barbeiro visitante", usuarioId: u.id } });
  const servico = await db.servico.create({ data: { nome: "Corte de teste", precoCentavos: 6000, duracaoMin: 30 } });
  const inicio = new Date(Date.now() - diasAtras * 86_400_000);
  await db.agendamento.create({ data: { clienteId, barbeiroId: barbeiro.id, servicoId: servico.id, inicio,
    fim: new Date(+inicio + 1_800_000), precoCentavos: 6000, origem: "SITE", status: "CONCLUIDO" } });
  return { barbeiroId: barbeiro.id, servicoId: servico.id };
}

describe.skipIf(!habilitado)("convite do Leonel pelo simulador do WhatsApp", () => {
  beforeAll(async () => {
    vi.stubEnv("SITE_URL", site);
    vi.stubEnv("AMBIENTE", "homologacao");
    vi.stubEnv("WHATSAPP_PROVIDER", "simulador");
    vi.stubEnv("WHATSAPP_ATENDIMENTO_IA_PAGA", "false");
    vi.stubEnv("WHATSAPP_ATENDIMENTO_APOS_PILOTO", "true");
    for (const flag of ["WHATSAPP_ENVIOS_BLOQUEADOS", "WHATSAPP_ATENDIMENTO_TESTE_EQUIPE", "WHATSAPP_PILOTO_ENTREVISTAS_HABILITADO", "BARBEROS_QUARENTENA_RESTAURACAO"]) vi.stubEnv(flag, "false");
    gestorId = (await db.usuario.create({ data: { nome: "Gestor do teste", telefone: randomUUID(), papel: "GERENTE" } })).id;
    await db.configuracao.upsert({ where: { id: 1 }, create: { id: 1, botAtivo: true }, update: { botAtivo: true } });
  });
  afterAll(async () => { vi.unstubAllEnvs(); await db.$disconnect(); });

  it("abre uma vez, espera a entrada e entrega o endereço num balão exclusivo", async () => {
    const { id, telefone } = await contato();
    const cliques = await Promise.allSettled([iniciarConviteApp(id, gestorId), iniciarConviteApp(id, gestorId)]);
    expect(await db.auditoria.count({ where: { usuarioId: gestorId, acao: "iniciar_convite_app", entidadeId: id } })).toBe(1);
    expect(cliques.map(r => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(await falas(id)).toEqual(abertura);
    expect((await etapa(id)).conviteApp).toBe("AGUARDANDO");
    const entrada = { telefone, texto: "Oi, Leonel! Tudo bem?", wamid: randomUUID() };
    await receberMensagem(entrada);
    await receberMensagem(entrada);
    expect(await falas(id)).toEqual([...abertura, expect.stringMatching(/^A gente está trocando o aplicativo.*Aqui está o link 👇$/), expect.stringMatching(/^https:\/\/black\.exemplo\.test\/c\/entrar\?convite=app_[0-9a-f]{32}$/)]);
    expect((await etapa(id)).conviteApp).toBe("ENCERRADO");
  });

  it.each(["Não, obrigado!", "PARAR", "Quero falar com alguém da equipe"])("respeita a resposta %s", async texto => {
    const { id, telefone } = await contato();
    await iniciarConviteApp(id, gestorId);
    await receberMensagem({ telefone, texto, wamid: randomUUID() });
    const mensagens = await falas(id);
    expect(mensagens.slice(0, 2)).toEqual(abertura);
    expect(mensagens).toHaveLength(3);
    expect(mensagens[2]).not.toMatch(/https?:|aqui está o link/i);
    expect(await etapa(id)).toMatchObject({ conviteApp: "ENCERRADO", recusaAutomaticas: texto === "PARAR",
      estado: texto.startsWith("Quero") ? "HUMANO" : "BOT" });
  });

  it("transforma o aceite interpretado pelo modelo nos mesmos dois balões", async () => {
    const { id, telefone } = await contato();
    await iniciarConviteApp(id, gestorId);
    vi.stubEnv("WHATSAPP_ATENDIMENTO_IA_PAGA", "true");
    try {
      const criar: Modelo["criar"] = async ({ messages }) => {
        expect(JSON.stringify(messages)).toContain("A saudação e a apresentação do convite");
        return { stop_reason: "end_turn", content: [{ type: "text", text: "[CONVITE_APP]" }] } as Awaited<ReturnType<Modelo["criar"]>>;
      };
      await receberMensagem({ telefone, texto: "Manda aí pra eu ver como ficou, Leonel!", wamid: randomUUID() }, { modelo: { criar } });
      const mensagens = await falas(id);
      expect(mensagens).toEqual([...abertura, expect.stringContaining("Aqui está o link 👇"), expect.stringMatching(/^https:\/\/black\.exemplo\.test\/c\/entrar\?convite=app_[0-9a-f]{32}$/)]);
      const sessao = await db.conversa.findUniqueOrThrow({ where: { id }, select: { sessao: true } });
      expect(sessao.sessao).toEqual(expect.arrayContaining([{ role: "assistant", content: mensagens.slice(2).join("\n\n") }]));
    } finally { vi.stubEnv("WHATSAPP_ATENDIMENTO_IA_PAGA", "false"); }
  });

  it("conta o clique uma vez, distingue a tela de login e só atribui o acesso ao titular", async () => {
    const { id, telefone, clienteId } = await contato();
    await iniciarConviteApp(id, gestorId);
    await receberMensagem({ telefone, texto: "Pode falar", wamid: randomUUID() });
    const j = await db.jornadaConviteApp.findUniqueOrThrow({ where: { conversaId: id } });
    expect(j.clicouEm).toBeNull();
    const evento = (tipo: string) => visita(new NextRequest(site + "/api/convite-app/visita", { method: "POST",
      headers: { origin: site, "content-type": "application/json", cookie: "black_convite_app=" + j.token },
      body: JSON.stringify({ evento: tipo, ...(["clique", "login"].includes(tipo) ? { token: j.token } : {}) }) }));
    const antes = (await relatorioConvites(1)).totais.cliques;
    expect((await evento("login")).headers.get("set-cookie")).toContain("HttpOnly");
    expect((await relatorioConvites(1)).totais.cliques).toBe(antes + 1);
    await evento("login"); await evento("clique"); await evento("agenda");
    expect((await relatorioConvites(1)).totais.cliques).toBe(antes + 1);
    sessao.mockResolvedValue({ papel: "CLIENTE", clienteId: "outro" });
    await evento("entrou");
    expect((await db.jornadaConviteApp.findUniqueOrThrow({ where: { conversaId: id } })).entrouEm).toBeNull();
    sessao.mockResolvedValue({ papel: "CLIENTE", clienteId: clienteId! });
    try { await evento("entrou"); await evento("agenda"); await evento("instalou"); } finally { sessao.mockResolvedValue(null); }
    expect(await db.jornadaConviteApp.findUniqueOrThrow({ where: { conversaId: id } })).toMatchObject({
      clicouEm: expect.any(Date), loginEm: expect.any(Date), entrouEm: expect.any(Date), agendaEm: expect.any(Date), instalouEm: expect.any(Date),
    });
  });

  it("só retoma em horário comercial e encerra em três tentativas, inclusive com duas rotinas", async () => {
    const { id, clienteId } = await contato();
    await iniciarConviteApp(id, gestorId);
    const dia = 86_400_000, inicio = new Date();
    inicio.setUTCHours(15, 0, 0, 0);
    const fuso = "America/Sao_Paulo";
    await db.jornadaConviteApp.update({ where: { conversaId: id }, data: { inicioEm: inicio, proximaEm: new Date(+inicio + dia) } });
    const rodar = (t: number) => rodarRetomadas(t, fuso, [clienteId!]);
    expect(await rodar(+inicio + dia - 1)).toBe(0);
    expect(await rodar(+inicio + dia + 10*3_600_000)).toBe(0);
    expect((await Promise.all([rodar(+inicio + dia), rodar(+inicio + dia)])).sort()).toEqual([0, 1]);
    expect(await rodar(+inicio + 3*dia)).toBe(1);
    expect(await rodar(+inicio + 7*dia)).toBe(1);
    expect(await rodar(+inicio + 12*dia)).toBe(0);
    expect(await falas(id)).toHaveLength(5);
    expect((await falas(id)).every(t => !t.includes("https://"))).toBe(true);
  });

  it("lembra em 24h e 90 min, confirma o SIM e registra o comparecimento", async () => {
    const { id, telefone, clienteId } = await contato();
    await iniciarConviteApp(id, gestorId);
    await receberMensagem({ telefone, texto: "Oi!", wamid: randomUUID() });
    const cfg = await db.configuracao.findUniqueOrThrow({ where: { id: 1 } });
    const u = await db.usuario.create({ data: { nome: "Barbeiro teste", telefone: randomUUID(), papel: "BARBEIRO" } });
    const barbeiro = await db.barbeiro.create({ data: { nome: "Barbeiro teste", usuarioId: u.id } });
    const servico = await db.servico.create({ data: { nome: "Teste", precoCentavos: 100, duracaoMin: 20 } });
    const inicio = new Date(Date.now() + 3 * 86_400_000); inicio.setUTCHours(16, 0, 0, 0);
    const ag = await db.agendamento.create({ data: { clienteId: clienteId!, barbeiroId: barbeiro.id, servicoId: servico.id,
      inicio, fim: new Date(+inicio + 1200000), precoCentavos: 100, origem: "SITE" } });
    const lembrar = (min: number) => lembrarHorarios(+inicio - min * 60000, cfg, [clienteId!], true);
    expect(await lembrar(1441)).toBe(0); expect(await lembrar(1440)).toBe(1); expect(await lembrar(1439)).toBe(0);
    await receberMensagem({ telefone, texto: "SIM", wamid: randomUUID() });
    expect((await db.agendamento.findUniqueOrThrow({ where: { id: ag.id } })).status).toBe("CONFIRMADO");
    expect(await lembrar(90)).toBe(1); expect(await lembrar(89)).toBe(0);
    await db.agendamento.update({ where: { id: ag.id }, data: { status: "CHEGOU" } });
    expect((await relatorioConvites(1)).linhas.find(l => l.conversaId === id)).toMatchObject({ marcou: true, compareceu: true });
  });

  it("envia o link no segundo balão e oferece ajuda cinco horas após a abertura", async () => {
    const { id, clienteId } = await contato();
    await visitaConcluida(clienteId!, 10);
    const inicio = new Date(); inicio.setUTCHours(13, 0, 0, 0);
    vi.setSystemTime(inicio);
    try {
      expect(await iniciarConviteApp(id, gestorId, true)).toEqual({ segmento: "quente" });
      const j = await db.jornadaConviteApp.findUniqueOrThrow({ where: { conversaId: id } });
      expect(j).toMatchObject({ aberturaId: expect.any(String), linkId: expect.any(String),
        proximaEm: new Date(+inicio + 5 * 3_600_000) });
      expect(await falas(id)).toEqual(["Fala, João, tudo bem? Aqui é o Leonel da Black.", expect.stringContaining(j.token)]);
      // O relógio do PostgreSQL é independente do relógio simulado do Vitest.
      await db.mensagem.update({ where: { id: j.linkId! }, data: { criadoEm: inicio } });
      const rodar = (t: number) => rodarRetomadas(t, "America/Sao_Paulo", [clienteId!]);
      expect(await rodar(+j.proximaEm! - 1)).toBe(0);
      expect((await Promise.all([rodar(+j.proximaEm!), rodar(+j.proximaEm!)])).sort()).toEqual([0, 1]);
      expect((await falas(id)).at(-1)).toContain("Conseguiu abrir o link");
    } finally { vi.useRealTimers(); }
  });

  it("oferece ajuda com o cadastro depois do clique e encerra a retomada quando o cliente recusa", async () => {
    const { id, telefone, clienteId } = await contato();
    await visitaConcluida(clienteId!, 45);
    expect(await iniciarConviteApp(id, gestorId, true)).toEqual({ segmento: "morno" });
    const clique = new Date(); clique.setUTCDate(clique.getUTCDate() + 1); clique.setUTCHours(12, 0, 0, 0);
    const depois = new Date(+clique + 5 * 3_600_000);
    await db.jornadaConviteApp.update({ where: { conversaId: id },
      data: { clicouEm: clique, proximaEm: depois } });
    expect(await rodarRetomadas(+depois, "America/Sao_Paulo", [clienteId!])).toBe(1);
    expect((await falas(id)).at(-1)).toContain("Conseguiu terminar o cadastro?");
    await receberMensagem({ telefone, texto: "Não, obrigado!", wamid: randomUUID() });
    const recusou = await db.jornadaConviteApp.findUniqueOrThrow({ where: { conversaId: id } });
    expect(recusou).toMatchObject({ parouEm: expect.any(Date), proximaEm: null });
  });

  it("abre a roleta antes do cadastro e conserva um único resultado", async () => {
    const { id, clienteId } = await contato();
    await visitaConcluida(clienteId!, 200);
    const jogoId = `roleta-leonel-teste-${randomUUID()}`;
    await db.jogo.create({ data: { id: jogoId, tipo: "ROLETA", nome: "Roleta de teste", ativo: true,
      premios: { create: { tipo: "DESCONTO", rotulo: "Desconto teste", percentual: 10, cor: "#000000", chanceBps: 10000 } } } });
    const campanhaId = idModeloSegmento("frio");
    await db.campanha.upsert({ where: { id: campanhaId }, update: { jogoId }, create: {
      id: campanhaId, segmentos: ["frio"], nome: "Frio teste", status: "PAUSADA", limiteDiario: 1, mensagem: "Veja {link}", jogoId,
    } });
    expect(await iniciarConviteApp(id, gestorId, true)).toEqual({ segmento: "frio" });
    const j = await db.jornadaConviteApp.findUniqueOrThrow({ where: { conversaId: id } });
    expect((await falas(id))[1]).toContain(`/c/r/${j.token}`);
    expect(await db.campanhaEnvio.findUniqueOrThrow({ where: { token: j.token } })).toMatchObject({ status: "ENVIADO", lote: 0, mensagemId: j.linkId });
    expect(await landingDaCampanha(j.token)).toMatchObject({ jogo: { tipo: "ROLETA", jogada: null } });
    const first = await jogarPelaCampanha(j.token, { ip: null });
    const second = await jogarPelaCampanha(j.token, { ip: null });
    expect(second).toEqual({ jogada: first.jogada, jaJogou: true });
    expect(first.jogada.premios).toHaveLength(1);
  });

  it("confirma a reserva feita no app e encerra as retomadas", async () => {
    const { id, clienteId } = await contato();
    const servicos = await visitaConcluida(clienteId!, 10);
    await iniciarConviteApp(id, gestorId, true);
    const inicio = new Date(Date.now() + 2 * 86_400_000);
    const ag = await db.agendamento.create({ data: { clienteId: clienteId!, ...servicos, inicio,
      fim: new Date(+inicio + 1_800_000), precoCentavos: 6000, origem: "SITE" } });
    await Promise.all([avisarReservaPeloApp(ag.id, clienteId!), avisarReservaPeloApp(ag.id, clienteId!)]);
    const mensagens = await falas(id);
    expect(mensagens).toHaveLength(3);
    expect(mensagens.at(-1)).toContain("Vou te mandar um lembrete");
    expect((await db.jornadaConviteApp.findUniqueOrThrow({ where: { conversaId: id } })).proximaEm).toBeNull();
  });

  it("encerra quando a equipe assume e não reabre ao devolver a conversa", async () => {
    const { id } = await contato();
    await iniciarConviteApp(id, gestorId);
    for (const estado of ["HUMANO", "BOT"] as const) await db.conversa.update({ where: { id }, data: { estado } });
    expect((await etapa(id)).conviteApp).toBe("ENCERRADO");
    await expect(iniciarConviteApp(id, gestorId)).rejects.toMatchObject({ status: 409 });
    expect(await falas(id)).toEqual(abertura);
  });
});
