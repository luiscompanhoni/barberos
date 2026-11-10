import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ fetch: vi.fn(), auditar: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { whatsAppOficial: { findUnique: vi.fn() }, $transaction: (fn: (tx: unknown) => unknown) => fn({}) } }));
vi.mock("@/lib/auditoria", () => ({ auditar: m.auditar }));
import { apagarModelo, criarModelo, variaveisDoTexto } from "@/lib/whatsapp/modelos";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WHATSAPP_TOKEN", "fixture"); vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "111"); vi.stubEnv("WHATSAPP_WABA_ID", "222");
  vi.stubEnv("WHATSAPP_API_VERSION", "v23.0");
  m.fetch.mockResolvedValue({ ok: true, json: async () => ({ id: "9", status: "PENDING" }) });
  vi.stubGlobal("fetch", m.fetch);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("modelos de mensagem da Meta", () => {
  it("conta variáveis e exige numeração em sequência", () => {
    expect(variaveisDoTexto("Oi")).toBe(0);
    expect(variaveisDoTexto("Olá {{1}}, às {{2}} ({{1}})")).toBe(2);
    expect(() => variaveisDoTexto("Olá {{2}}")).toThrow("{{1}}");
  });

  it("cria na WABA com exemplos e audita", async () => {
    await criarModelo({ nome: "lembrete", categoria: "UTILITY", texto: "Olá {{1}}", exemplos: ["Ana"] }, "u1");
    const [url, init] = m.fetch.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v23.0/222/message_templates");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      name: "lembrete", language: "pt_BR", category: "UTILITY",
      components: [{ type: "BODY", text: "Olá {{1}}", example: { body_text: [["Ana"]] } }],
    });
    expect(m.auditar).toHaveBeenCalledWith({}, "u1", "whatsapp_modelo_criar", "configuracao", "whatsapp", expect.objectContaining({ nome: "lembrete" }));
  });

  it("recusa exemplos em número diferente das variáveis sem chamar a Meta", async () => {
    await expect(criarModelo({ nome: "x", categoria: "UTILITY", texto: "Olá {{1}}", exemplos: [] }, "u1")).rejects.toThrow("1 exemplo");
    expect(m.fetch).not.toHaveBeenCalled();
  });

  it("apaga pelo nome com DELETE e não audita se a Meta recusar", async () => {
    await apagarModelo("lembrete", "u1");
    expect(m.fetch.mock.calls[0][0]).toBe("https://graph.facebook.com/v23.0/222/message_templates?name=lembrete");
    expect(m.fetch.mock.calls[0][1].method).toBe("DELETE");
    m.auditar.mockClear();
    m.fetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { message: "não existe" } }) });
    await expect(apagarModelo("outro", "u1")).rejects.toThrow("A Meta recusou apagar o modelo");
    expect(m.auditar).not.toHaveBeenCalled();
  });

  it("sem WABA configurada avisa em vez de chamar a Meta", async () => {
    vi.stubEnv("WHATSAPP_WABA_ID", "");
    await expect(apagarModelo("lembrete", "u1")).rejects.toThrow("WHATSAPP_WABA_ID");
  });
});
