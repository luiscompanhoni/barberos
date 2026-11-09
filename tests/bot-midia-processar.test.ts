import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ entrada: vi.fn(), enviar: vi.fn(), modelo: vi.fn(), midia: vi.fn(), cfg: vi.fn(), piloto: vi.fn(), sessao: vi.fn(), estado: vi.fn(), update: vi.fn(), nota: vi.fn(), mensagens: vi.fn(), cliente: vi.fn(), alterarMensagem: vi.fn(), preferencia: vi.fn() }));
vi.mock("@/lib/whatsapp/conversas", () => ({ registrarEntrada: m.entrada, enviarNaConversa: m.enviar }));
vi.mock("@/lib/bot/agente", () => ({ executarTurno: m.modelo }));
vi.mock("@/lib/bot/multimodal", async (original) => ({ ...await original<typeof import("@/lib/bot/multimodal")>(), prepararMidia: m.midia }));
vi.mock("@/lib/agenda/carregar", () => ({ configuracao: m.cfg }));
vi.mock("@/lib/whatsapp/piloto", () => ({ estadoPiloto: m.piloto }));
vi.mock("@/lib/eventos", () => ({ publicar: vi.fn() }));
vi.mock("@/lib/whatsapp/preferencia", () => ({ travarPreferencia: vi.fn(), atualizarPreferencia: m.preferencia }));
vi.mock("@/lib/db", () => ({ db: {
  entrevistaRecrutamento: { findUnique: m.sessao }, conversa: { update: m.update, findUnique: m.estado },
  mensagem: { create: m.nota, findMany: m.mensagens, updateMany: m.alterarMensagem }, cliente: { findUnique: m.cliente },
  $transaction: async (fn: (tx: object) => unknown) => fn({}),
} }));
vi.mock("@/lib/bot/entrevistas", () => ({ processarBotEntrevista: vi.fn(), registroSeguroEntrevista: (s: string) => s, contemConviteEntrevista: () => false, comandoReservadoEntrevista: () => false }));
import { receberMensagem } from "@/lib/bot/processar";
const entrada = { telefone: "5547999990000", waId: "5547999990000", texto: null, wamid: "m1", midia: { provedor: "evolution" as const, tipo: "figurinha" as const, id: "m1" } };
const verificarEquipe = vi.hoisted(() => vi.fn());
vi.mock("@/lib/whatsapp/teste-equipe", () => ({
  destinatarioTesteEquipe: verificarEquipe,
  testeEquipeAtivo: () => process.env.WHATSAPP_ATENDIMENTO_TESTE_EQUIPE === "true",
}));

beforeEach(() => {
  vi.clearAllMocks();
  verificarEquipe.mockResolvedValue(false);
  vi.stubEnv("WHATSAPP_ATENDIMENTO_TESTE_EQUIPE", "false");
  for (const flag of ["WHATSAPP_ENVIOS_BLOQUEADOS", "WHATSAPP_PILOTO_ENTREVISTAS_HABILITADO", "WHATSAPP_ATENDIMENTO_APOS_PILOTO", "RECRUTAMENTO_ENTREVISTAS_WHATSAPP_ATIVO"]) vi.stubEnv(flag, "false");
  vi.stubEnv("WHATSAPP_ATENDIMENTO_IA_PAGA", "true");
  m.piloto.mockResolvedValue(null); m.sessao.mockResolvedValue(null); m.cliente.mockResolvedValue(null); m.mensagens.mockResolvedValue([]);
  m.estado.mockResolvedValue({ estado: "BOT" });
  m.entrada.mockResolvedValue({ id: "c1", telefone: entrada.telefone, estado: "BOT", sessao: null });
  m.cfg.mockResolvedValue({ botAtivo: true, fuso: "America/Sao_Paulo", janelaAgendamentoDias: 30, prazoCancelamentoMin: 60 });
  m.midia.mockResolvedValue({ texto: "[figurinha]", imagem: { tipo: "image/jpeg", base64: "BASE64_PRIVADO_TESTE" } });
  m.modelo.mockResolvedValue({ resposta: "Valeu!", historico: [{ role: "user", content: [{ type: "image", source: { data: "BASE64_PRIVADO_TESTE" } }] }] });
});
afterEach(() => vi.unstubAllEnvs());

describe("gates da entrada multimodal", () => {
  it("teste restrito responde à equipe com bloqueio geral, mas ignora cliente externo", async () => {
    vi.stubEnv("WHATSAPP_ATENDIMENTO_TESTE_EQUIPE", "true");
    vi.stubEnv("WHATSAPP_ENVIOS_BLOQUEADOS", "true");
    vi.stubEnv("WHATSAPP_ATENDIMENTO_IA_PAGA", "false");
    vi.stubEnv("WHATSAPP_PILOTO_ENTREVISTAS_HABILITADO", "true");
    await receberMensagem(entrada);
    expect(m.modelo).not.toHaveBeenCalled(); expect(m.midia).not.toHaveBeenCalled();
    verificarEquipe.mockResolvedValue(true);
    await receberMensagem({ ...entrada, wamid: "m2" });
    expect(m.modelo).toHaveBeenCalledTimes(1);
    expect(m.enviar).toHaveBeenCalledTimes(1);
  });
  it.each(["bloqueio", "humano", "bot_desligado", "duplicada", "ia_desligada"])("não baixa mídia em %s", async (caso) => {
    if (caso === "bloqueio") vi.stubEnv("WHATSAPP_ENVIOS_BLOQUEADOS", "true");
    if (caso === "humano") m.entrada.mockResolvedValue({ id: "c1", telefone: entrada.telefone, estado: "HUMANO" });
    if (caso === "bot_desligado") m.cfg.mockResolvedValue({ botAtivo: false });
    if (caso === "duplicada") m.entrada.mockResolvedValue(null);
    if (caso === "ia_desligada") { vi.stubEnv("WHATSAPP_ATENDIMENTO_IA_PAGA", "false"); vi.stubEnv("WHATSAPP_ATENDIMENTO_APOS_PILOTO", "true"); }
    await receberMensagem(entrada);
    expect(m.midia).not.toHaveBeenCalled(); expect(m.modelo).not.toHaveBeenCalled();
  });
  it("imagem isolada fica em consulta e não é gravada na sessão", async () => {
    await receberMensagem(entrada);
    expect(m.modelo).toHaveBeenCalledWith(expect.objectContaining({ somenteConsulta: true, imagem: expect.objectContaining({ base64: "BASE64_PRIVADO_TESTE" }) }));
    expect(JSON.stringify(m.update.mock.calls)).not.toContain("BASE64_PRIVADO_TESTE");
  });
  it("arquivo inválido transfere à equipe sem chamar modelo", async () => {
    m.midia.mockRejectedValue(new Error("arquivo inválido"));
    await receberMensagem(entrada);
    expect(m.modelo).not.toHaveBeenCalled();
    expect(m.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { estado: "HUMANO" } });
  });
  it("não responde se a equipe assume durante interpretação", async () => {
    m.midia.mockImplementation(async () => { m.estado.mockResolvedValue({ estado: "HUMANO" }); return { texto: "[imagem]", imagem: undefined }; });
    await receberMensagem(entrada);
    expect(m.modelo).not.toHaveBeenCalled(); expect(m.enviar).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled();
  });
  it("pedido PARAR transcrito usa preferência e não o modelo", async () => {
    m.midia.mockResolvedValue({ texto: "PARAR", imagem: undefined });
    await receberMensagem({ ...entrada, midia: { ...entrada.midia, tipo: "audio" } });
    expect(m.preferencia).toHaveBeenCalledWith(expect.anything(), entrada.telefone, false);
    expect(m.modelo).not.toHaveBeenCalled();
  });
  it("não manda aviso de transferência se a equipe já respondeu durante o turno", async () => {
    m.modelo.mockResolvedValue({ resposta: "Pedi para a equipe continuar por aqui.", historico: [], passouParaHumano: true });
    m.mensagens.mockImplementation(async (q: { where?: { autor?: string } }) => q.where?.autor === "EQUIPE" ? [{ id: "resposta-equipe" }] : []);
    await receberMensagem({ ...entrada, texto: "Preciso de uma pessoa", midia: undefined });
    expect(m.enviar).not.toHaveBeenCalled();
  });
  it("avisa transferência própria quando a equipe ainda não respondeu", async () => {
    m.modelo.mockResolvedValue({ resposta: "Pedi para a equipe continuar por aqui.", historico: [], passouParaHumano: true });
    await receberMensagem({ ...entrada, texto: "Preciso de uma pessoa", midia: undefined });
    expect(m.enviar).toHaveBeenCalledTimes(1);
  });
});
