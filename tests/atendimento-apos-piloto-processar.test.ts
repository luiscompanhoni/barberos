import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ entrada: vi.fn(), enviar: vi.fn(), modelo: vi.fn(), cfg: vi.fn(), piloto: vi.fn(), sessao: vi.fn(), update: vi.fn(), nota: vi.fn(), entrevista: vi.fn() }));
vi.mock("@/lib/whatsapp/conversas", () => ({ registrarEntrada: m.entrada, enviarNaConversa: m.enviar }));
vi.mock("@/lib/bot/agente", () => ({ executarTurno: m.modelo }));
vi.mock("@/lib/agenda/carregar", () => ({ configuracao: m.cfg }));
vi.mock("@/lib/whatsapp/piloto", () => ({ estadoPiloto: m.piloto }));
vi.mock("@/lib/eventos", () => ({ publicar: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { entrevistaRecrutamento: { findUnique: m.sessao }, conversa: { update: m.update }, mensagem: { create: m.nota } } }));
vi.mock("@/lib/bot/entrevistas", () => ({ processarBotEntrevista: m.entrevista, registroSeguroEntrevista: (s: string) => s, contemConviteEntrevista: (s: string) => s === "ENTREVISTA", comandoReservadoEntrevista: () => false }));
import { receberMensagem } from "@/lib/bot/processar";

const telefone = "5547999990000";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WHATSAPP_ENVIOS_BLOQUEADOS", "false");
  vi.stubEnv("WHATSAPP_ATENDIMENTO_TESTE_EQUIPE", "false");
  vi.stubEnv("WHATSAPP_PILOTO_ENTREVISTAS_HABILITADO", "true");
  vi.stubEnv("WHATSAPP_ATENDIMENTO_APOS_PILOTO", "true");
  vi.stubEnv("WHATSAPP_ATENDIMENTO_IA_PAGA", "false");
  vi.stubEnv("RECRUTAMENTO_ENTREVISTAS_WHATSAPP_ATIVO", "true");
  m.piloto.mockResolvedValue({ ativo: false, telefone, expiraEm: new Date(0), enviados: 0, versao: 2 });
  m.entrada.mockResolvedValue({ id: "conversa", telefone, estado: "BOT" });
  m.cfg.mockResolvedValue({ botAtivo: true }); m.sessao.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());

describe("atendimento sem IA paga após piloto", () => {
  it("bloqueio geral impede atendimento antes de consultar piloto ou modelo", async () => {
    vi.stubEnv("WHATSAPP_ENVIOS_BLOQUEADOS", "true");
    await receberMensagem({ telefone, texto: "oi" });
    expect(m.entrada).toHaveBeenCalled();
    for (const fn of [m.piloto, m.cfg, m.update, m.enviar, m.modelo, m.entrevista]) expect(fn).not.toHaveBeenCalled();
  });
  it("encaminha à equipe com resposta de acolhimento sem chamar modelo ou entrevista", async () => {
    await receberMensagem({ telefone, texto: "oi" });
    expect(m.update).toHaveBeenCalledWith({ where: { id: "conversa" }, data: { estado: "HUMANO" } });
    expect(m.enviar).toHaveBeenCalledWith("conversa", expect.stringContaining("equipe da Black"), "BOT", { respostaAtendimento: true });
    expect(m.modelo).not.toHaveBeenCalled(); expect(m.entrevista).not.toHaveBeenCalled();
  });
  it("não processa comandos de entrevista mesmo que sua chave antiga esteja ativa", async () => {
    await receberMensagem({ telefone, texto: "ENTREVISTA" });
    expect(m.entrevista).not.toHaveBeenCalled(); expect(m.modelo).not.toHaveBeenCalled(); expect(m.enviar).not.toHaveBeenCalled();
  });
  it("respeita o botão geral do bot", async () => {
    m.cfg.mockResolvedValue({ botAtivo: false });
    await receberMensagem({ telefone, texto: "oi" });
    expect(m.modelo).not.toHaveBeenCalled(); expect(m.enviar).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled();
  });
  it("não responde nem chama modelo durante o piloto ativo para outro número", async () => {
    m.piloto.mockResolvedValue({ ativo: true, telefone: "5547999990001", expiraEm: new Date(Date.now() + 60_000), enviados: 0, versao: 1 });
    await receberMensagem({ telefone, texto: "oi" });
    expect(m.enviar).not.toHaveBeenCalled(); expect(m.modelo).not.toHaveBeenCalled(); expect(m.cfg).not.toHaveBeenCalled();
  });
  it.each(["false", ""])("sem piloto, a chave de IA %s impede chamada paga", async (chave) => {
    vi.stubEnv("WHATSAPP_PILOTO_ENTREVISTAS_HABILITADO", "false");
    vi.stubEnv("RECRUTAMENTO_ENTREVISTAS_WHATSAPP_ATIVO", "false");
    vi.stubEnv("WHATSAPP_ATENDIMENTO_IA_PAGA", chave);
    m.piloto.mockResolvedValue(null);
    await receberMensagem({ telefone, texto: "oi" });
    expect(m.modelo).not.toHaveBeenCalled();
    expect(m.update).toHaveBeenCalledWith({ where: { id: "conversa" }, data: { estado: "HUMANO" } });
    expect(m.enviar).toHaveBeenCalledWith("conversa", expect.stringContaining("equipe da Black"), "BOT", { respostaAtendimento: true });
  });
  it.each(["oi", "PARAR", null])("não envia resposta a %s sem ativação explícita do atendimento", async (texto) => {
    vi.stubEnv("WHATSAPP_PILOTO_ENTREVISTAS_HABILITADO", "false");
    vi.stubEnv("WHATSAPP_ATENDIMENTO_APOS_PILOTO", "false");
    vi.stubEnv("RECRUTAMENTO_ENTREVISTAS_WHATSAPP_ATIVO", "false");
    m.piloto.mockResolvedValue(null);
    await receberMensagem({ telefone, texto });
    expect(m.modelo).not.toHaveBeenCalled();
    expect(m.enviar).not.toHaveBeenCalled();
  });
  it.each(["humano", "bot_desligado", "piloto_ativo", "piloto_encerrado_sem_atendimento"])("registra PARAR mesmo em %s, sem enviar confirmação", async (cenario) => {
    if (cenario === "humano") m.entrada.mockResolvedValue({ id: "conversa", telefone, estado: "HUMANO" });
    if (cenario === "bot_desligado") m.cfg.mockResolvedValue({ botAtivo: false });
    if (cenario === "piloto_ativo") m.piloto.mockResolvedValue({ ativo: true, telefone, expiraEm: new Date(Date.now() + 60000), enviados: 0, versao: 1 });
    if (cenario === "piloto_encerrado_sem_atendimento") vi.stubEnv("WHATSAPP_ATENDIMENTO_APOS_PILOTO", "false");
    await receberMensagem({ telefone, texto: "PARAR" });
    expect(m.entrada).toHaveBeenCalledWith(expect.objectContaining({ telefone, optOut: true }));
    expect(m.enviar).not.toHaveBeenCalled();
    expect(m.modelo).not.toHaveBeenCalled();
  });
});
