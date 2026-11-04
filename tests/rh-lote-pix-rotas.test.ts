import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ sessao: vi.fn(), previa: vi.fn(), preparar: vi.fn() }));
vi.mock("@/lib/auth/permissoes", () => ({ exigirSessaoCom: m.sessao }));
vi.mock("@/lib/rh/lote-pix", () => ({ previaLotePix: m.previa, prepararLotePix: m.preparar }));
import { GET, POST } from "@/app/api/rh/folha/lote-pix/route";
import { ErroNegocio } from "@/lib/erros";
const base = "https://painel.example";
const body = { acao: "preparar", competencia: "2026-11", revisao: "a".repeat(64) };
const request = (dados: unknown, origin = base) => new Request(base + "/api/rh/folha/lote-pix", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(dados) });
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("PAINEL_URL", base);
  m.sessao.mockResolvedValue({ usuarioId: "dono", papel: "DONO" }); m.previa.mockResolvedValue({ envioHabilitado: false }); m.preparar.mockResolvedValue({ envioHabilitado: false });
});
describe("rotas Pix: apenas preparação", () => {
  it("exige permissão folha antes de qualquer leitura ou mutação", async () => {
    m.sessao.mockRejectedValue(new ErroNegocio("Acesso recusado", 403));
    expect((await GET(new Request(base + "/api/rh/folha/lote-pix?competencia=2026-11"))).status).toBe(403);
    expect((await POST(request(body))).status).toBe(403); expect(m.previa).not.toHaveBeenCalled(); expect(m.preparar).not.toHaveBeenCalled();
  });
  it("não aceita enviar, campos extras ou competência inválida", async () => {
    for (const dados of [{ ...body, acao: "enviar" }, { ...body, autorizarPagamento: true }, { ...body, competencia: "2026-13" }]) expect((await POST(request(dados))).status).toBe(400);
    expect(m.preparar).not.toHaveBeenCalled();
  });
  it("origem externa é recusada e conteúdo grande não chega ao serviço", async () => {
    expect((await POST(request(body, "https://externo.example"))).status).toBe(403);
    expect((await POST(request({ ...body, sobra: "x".repeat(33000) }))).status).toBe(413); expect(m.preparar).not.toHaveBeenCalled();
  });
  it("respostas privadas não podem ser cacheadas e sessão vem do servidor", async () => {
    const get = await GET(new Request(base + "/api/rh/folha/lote-pix?competencia=2026-11"));
    expect(get.headers.get("cache-control")).toBe("private, no-store");
    expect((await POST(request(body))).status).toBe(200); expect(m.sessao).toHaveBeenCalledWith("folha");
    expect(m.preparar).toHaveBeenCalledWith({ usuarioId: "dono", papel: "DONO" }, body);
  });
});
