import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ identificar: vi.fn(), pagar: vi.fn(), publico: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/pagamentos/gateway", () => ({ provedorPagamento: () => "simulado" }));
vi.mock("@/lib/links/checkout", () => ({ identificarLinkCheckout: m.identificar }));
vi.mock("@/lib/links/servico", () => ({ pagarLink: m.pagar, linkPublico: m.publico }));
import { POST, GET } from "@/app/api/pagamentos/link/[token]/route";
import { ErroNegocio } from "@/lib/erros";

const token = "ABCDEFGHIJKLMNOPQRSTUVWX";
const ctx = (valor = token) => ({ params: Promise.resolve({ token: valor }) });
const pedido = (body: BodyInit = JSON.stringify({ forma: "PIX" }), headers: Record<string, string> = {}) => new Request(`https://example.invalid/api/pagamentos/link/${token}`, {
  method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.1", ...headers }, body,
});
const memoria = globalThis as unknown as { tentativasCheckout: Map<string, number[]>; expiracoesCheckout: Map<string, number> };
beforeEach(() => {
  vi.resetAllMocks(); memoria.tentativasCheckout.clear(); memoria.expiracoesCheckout.clear();
  m.identificar.mockResolvedValue("link-existente"); m.pagar.mockResolvedValue({ status: "PENDENTE", pix: null }); m.publico.mockResolvedValue({ checkout: { status: "PENDENTE" } });
});

describe("fronteira pública do checkout de link", () => {
  it("preserva a cobrança válida e limita por identificação encontrada no servidor", async () => {
    const body = JSON.stringify({ forma: "CARTAO", cartaoToken: "token_sintetico" });
    for (let i = 0; i < 5; i++) expect((await POST(pedido(body), ctx())).status).toBe(201);
    expect((await POST(pedido(body), ctx())).status).toBe(429);
    expect(m.pagar).toHaveBeenCalledTimes(5);
    expect([...memoria.tentativasCheckout.keys()].filter((k) => k.startsWith("link:"))).toEqual(["link:link-existente:CARTAO"]);
  });

  it("tokens inexistentes não criam contadores financeiros e rotação não contorna o limite de acesso", async () => {
    m.identificar.mockRejectedValue(new ErroNegocio("Link não encontrado", 404));
    const statuses = [];
    for (let i = 0; i < 100; i++) statuses.push((await POST(pedido(), ctx(`inexistente-${String(i).padStart(16, "0")}`))).status);
    expect(statuses).toContain(404); expect(statuses).toContain(429);
    expect(m.pagar).not.toHaveBeenCalled();
    expect([...memoria.tentativasCheckout.keys()].some((k) => k.startsWith("link:"))).toBe(false);
    expect(memoria.tentativasCheckout.size).toBeLessThan(5);
  });

  it("rejeita token malformado antes de consultar dados", async () => {
    expect((await POST(pedido(), ctx("x".repeat(129)))).status).toBe(400);
    expect((await GET(new Request("https://example.invalid/api/pagamentos/link/x"), ctx("x"))).status).toBe(400);
    expect(m.identificar).not.toHaveBeenCalled(); expect(m.publico).not.toHaveBeenCalled(); expect(m.pagar).not.toHaveBeenCalled();
  });

  it("rejeita Content-Length acima do limite antes de ler o corpo", async () => {
    expect((await POST(pedido("{}", { "content-length": "40000" }), ctx())).status).toBe(413);
    expect(m.identificar).not.toHaveBeenCalled(); expect(m.pagar).not.toHaveBeenCalled();
  });

  it("interrompe o fluxo acima do limite mesmo sem Content-Length", async () => {
    let cancelado = false;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(10_000).fill(32)); }, cancel() { cancelado = true; } });
    const req = new Request(`https://example.invalid/api/pagamentos/link/${token}`, { method: "POST", body: stream, duplex: "half", headers: { "content-type": "application/json" } } as RequestInit & { duplex: string });
    expect((await POST(req, ctx())).status).toBe(413);
    expect(cancelado).toBe(true); expect(m.identificar).not.toHaveBeenCalled(); expect(m.pagar).not.toHaveBeenCalled();
  });
});
