import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ enviar: vi.fn(), mensagem: vi.fn(), conversa: vi.fn(), cliente: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { conversa: { findUniqueOrThrow: m.conversa }, cliente: { findUnique: m.cliente }, mensagem: { create: m.mensagem } } }));
vi.mock("@/lib/eventos", () => ({ publicar: vi.fn() }));
vi.mock("@/lib/whatsapp/canal", () => ({ enviarTexto: m.enviar, enviarTemplate: vi.fn(), temJanela24h: vi.fn() }));
import { enviarNaConversa } from "@/lib/whatsapp/conversas";

beforeEach(() => {
  vi.clearAllMocks();
  m.conversa.mockResolvedValue({ telefone: "5547999990000", waId: null });
  m.cliente.mockResolvedValue(null);
  m.mensagem.mockResolvedValue({ id: "mensagem" });
  m.enviar.mockResolvedValue({ wamid: "simulado" });
});

describe("origem interna do envio de conversa", () => {
  it("marca somente respostas da equipe e bot identificado como atendimento", async () => {
    await enviarNaConversa("c", "oi", "EQUIPE");
    await enviarNaConversa("c", "oi", "BOT", { respostaAtendimento: true });
    await enviarNaConversa("c", "oi", "SISTEMA", { respostaAtendimento: true });
    await enviarNaConversa("c", "oi", "BOT");
    expect(m.enviar.mock.calls.map(c => c[3])).toEqual(["ATENDIMENTO", "ATENDIMENTO", "PADRAO", "PADRAO"]);
  });
  it("prioriza a origem de entrevista quando explicitamente informada", async () => {
    await enviarNaConversa("c", "oi", "BOT", { entrevistaPiloto: true, respostaAtendimento: true });
    expect(m.enviar.mock.calls[0][3]).toBe("ENTREVISTA_PILOTO");
  });
  it("bloqueia envio automático após recusa sem impedir resposta humana", async () => {
    m.conversa.mockResolvedValue({ telefone: "5547999990000", waId: null, recusaAutomaticas: true });
    const bloqueado = await enviarNaConversa("c", "novidade", "SISTEMA");
    expect(bloqueado.ok).toBe(false);
    expect(m.enviar).not.toHaveBeenCalled();
    const humano = await enviarNaConversa("c", "resposta", "EQUIPE");
    expect(humano.ok).toBe(true);
    expect(m.enviar).toHaveBeenCalledTimes(1);
  });
  it("também respeita recusa legada do cliente sem registro anterior na conversa", async () => {
    m.cliente.mockResolvedValue({ aceitaMensagens: false });
    const resultado = await enviarNaConversa("c", "novidade", "SISTEMA");
    expect(resultado.ok).toBe(false);
    expect(m.enviar).not.toHaveBeenCalled();
  });
});
