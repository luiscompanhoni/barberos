import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
const m = vi.hoisted(() => ({ acesso: vi.fn(), tentativas: vi.fn(), ativar: vi.fn() }));
vi.mock("@/lib/assinaturas/cartao-pix", () => ({ ativarComCartao: m.ativar }));
vi.mock("@/lib/pagamentos/checkout", async () => {
  const { z } = await import("zod");
  return { limitarAcessoCheckout: m.acesso, limitarTentativas: m.tentativas, zCartaoToken: z.string().max(512).regex(/^token_[A-Za-z0-9]+$/) };
});
import { POST } from "@/app/api/pagamentos/cartao/route";
import { corpo } from "@/lib/validacao";
import { limitarIdentificadorSenha, limitarOrigemAutenticacao } from "@/lib/auth/limites";
import { _zerarLimites } from "@/lib/limite";
import { ErroNegocio } from "@/lib/erros";
import { exigirOrigemCliente } from "@/lib/auth/http-cliente";

beforeEach(() => { vi.clearAllMocks(); _zerarLimites(); m.ativar.mockResolvedValue({ status: "ATIVA" }); });
afterEach(() => vi.unstubAllEnvs());
const dados = { assinatura: "fixture-assinatura-aleatoria-123456", cartaoToken: "token_Fixture123" };
const cabecalhos: Record<string, string>[] = [{}, { "content-length": "1" }];
const req = (body: unknown, headers: Record<string, string> = {}) => new Request("https://fixture.test/api/pagamentos/cartao", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

describe("limites reais antes de processar checkout legado", () => {
  it("aplica freio global/origem antes de ler JSON ou ativar cartão", async () => {
    m.acesso.mockImplementationOnce(() => { throw new ErroNegocio("Limite", 429); });
    const pedido = req(dados); const leitor = vi.spyOn(pedido.body!, "getReader");
    expect((await POST(pedido)).status).toBe(429);
    expect(leitor).not.toHaveBeenCalled(); expect(m.tentativas).not.toHaveBeenCalled(); expect(m.ativar).not.toHaveBeenCalled();
  });
  it.each(cabecalhos)("recusa 33KB sem confiar no Content-Length %#", async headers => {
    expect((await POST(req({ ...dados, extra: "x".repeat(33_000) }, headers))).status).toBe(413);
    expect(m.tentativas).not.toHaveBeenCalled(); expect(m.ativar).not.toHaveBeenCalled();
  });
  it("exige application/json e preserva entrada legítima com limite por assinatura", async () => {
    expect((await POST(req(dados, { "content-type": "text/plain" }))).status).toBe(415);
    expect((await POST(req(dados))).status).toBe(200);
    expect(m.tentativas).toHaveBeenCalledWith(`assinatura:${dados.assinatura}:CARTAO`);
    expect(m.ativar).toHaveBeenCalledOnce();
  });
  it("helper comum aceita foto válida em tamanho legado e barra excesso real", async () => {
    const schema = z.object({ dataUrl: z.string() });
    expect((await corpo(req({ dataUrl: "a".repeat(800_000) }), schema)).dataUrl.length).toBe(800_000);
    await expect(corpo(req({ dataUrl: "a".repeat(1_049_000) }, { "content-length": "1" }), schema)).rejects.toMatchObject({ status: 413 });
  });
  it("cancela o stream quando ultrapassa o limite mesmo em pedaços", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(20_000)); c.enqueue(new Uint8Array(20_000)); }, cancel });
    const pedido = new Request("https://fixture.test", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    await expect(corpo(pedido, z.unknown(), { maxBytes: 32_768 })).rejects.toMatchObject({ status: 413 });
    expect(cancel).toHaveBeenCalledOnce();
  });
});

describe("freio de autenticação sem expor identificadores nos contadores", () => {
  it("mesmo telefone em formatos distintos compartilha limite por conta", () => {
    for (let i = 0; i < 30; i++) limitarIdentificadorSenha(i % 2 ? "11 99999-0000" : "5511999990000");
    expect(() => limitarIdentificadorSenha("(11) 99999-0000")).toThrow();
  });
  it("origem é limitada antes do corpo; outra origem não herda o limite individual", () => {
    const pedido = new Request("https://fixture.test", { headers: { "x-forwarded-for": "192.0.2.1" } });
    for (let i = 0; i < 60; i++) limitarOrigemAutenticacao(pedido);
    expect(() => limitarOrigemAutenticacao(pedido)).toThrow();
    expect(() => limitarOrigemAutenticacao(new Request("https://fixture.test", { headers: { "x-forwarded-for": "192.0.2.2" } }))).not.toThrow();
  });
  it("cadastro e recuperação compartilham o limite mesmo antes de existir uma conta", () => {
    vi.stubEnv("SITE_URL", "https://fixture.test");
    const pedido = new Request("https://fixture.test/api/auth/recuperar-senha", { headers: { origin: "https://fixture.test" } });
    for (let i = 0; i < 60; i++) exigirOrigemCliente(pedido);
    expect(() => exigirOrigemCliente(pedido)).toThrow();
  });
});
