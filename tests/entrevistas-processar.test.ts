import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
const m = vi.hoisted(() => ({ entrada: vi.fn(), enviar: vi.fn(), modelo: vi.fn(), cfg: vi.fn(), sessao: vi.fn() }));
vi.mock("@/lib/whatsapp/conversas", () => ({ registrarEntrada: m.entrada, enviarNaConversa: m.enviar }));
vi.mock("@/lib/bot/agente", () => ({ executarTurno: m.modelo }));
vi.mock("@/lib/db", () => ({ db: { entrevistaRecrutamento: { findUnique: m.sessao } } }));
vi.mock("@/lib/agenda/carregar", () => ({ configuracao: m.cfg }));
import { receberMensagem } from "@/lib/bot/processar";
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("WHATSAPP_PILOTO_ENTREVISTAS_HABILITADO", "false"); });
afterEach(() => vi.unstubAllEnvs());
describe("convites não entram no modelo operacional", () => {
  it("a chave geral do bot impede inclusive entrevista quando desativada", async () => {
    vi.stubEnv("RECRUTAMENTO_ENTREVISTAS_WHATSAPP_ATIVO", "true");
    m.entrada.mockResolvedValue({ id: "conversa-ficticia", telefone: "5547999990000", estado: "BOT" });
    m.cfg.mockResolvedValue({ botAtivo: false });
    await receberMensagem({ telefone: "5547999990000", texto: "ENTREVISTA "+"a".repeat(43) });
    expect(m.modelo).not.toHaveBeenCalled(); expect(m.enviar).not.toHaveBeenCalled(); expect(m.sessao).not.toHaveBeenCalled();
  });
  it("uma conversa vinculada continua isolada quando o transporte é desligado", async () => {
    vi.stubEnv("RECRUTAMENTO_ENTREVISTAS_WHATSAPP_ATIVO", "false");
    m.entrada.mockResolvedValue({ id: "conversa-ficticia", telefone: "5547999990000", estado: "BOT" });
    m.sessao.mockResolvedValue({ id: "entrevista-ficticia" });
    await receberMensagem({ telefone: "5547999990000", texto: "SIM" });
    expect(m.modelo).not.toHaveBeenCalled(); expect(m.enviar).not.toHaveBeenCalled(); expect(m.cfg).not.toHaveBeenCalled();
  });
  it.each(["ENTREVISTA "+"a".repeat(43), "Olá ENTREVISTA "+"a".repeat(43)+" obrigado", "https://black.example/entrevistas#"+"a".repeat(43), "CONFIRMAR 2", "HORARIOS"])("não encaminha o convite/comando ao modelo: %s", async (texto) => {
    vi.stubEnv("RECRUTAMENTO_ENTREVISTAS_WHATSAPP_ATIVO", "false");
    m.entrada.mockResolvedValue({ id: "conversa-ficticia", telefone: "5547999990000", estado: "BOT" });
    const token = "a".repeat(43);
    await receberMensagem({ telefone: "5547999990000", texto });
    expect(m.entrada.mock.calls[0][0].texto).not.toContain(token);
    expect(m.modelo).not.toHaveBeenCalled(); expect(m.enviar).not.toHaveBeenCalled(); expect(m.cfg).not.toHaveBeenCalled();
  });
});
