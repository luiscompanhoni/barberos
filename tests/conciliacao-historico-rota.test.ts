import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ sessao: vi.fn(), consultar: vi.fn(), prever: vi.fn(), aplicar: vi.fn() }));
vi.mock("@/lib/auth/sessao", () => ({ exigirSessao: mocks.sessao }));
vi.mock("@/lib/conciliacao/historico/consulta", () => ({ consultarHistorico: mocks.consultar, preverHistorico: mocks.prever }));
vi.mock("@/lib/conciliacao/historico/aplicar", () => ({ aplicarHistorico: mocks.aplicar }));
import { GET, POST } from "@/app/api/financeiro/historico/route";
import { ErroNegocio } from "@/lib/erros";
const url = "https://painel.example/api/financeiro/historico";
const escolha = { transacaoId: "91001", assinaturaId: "a", operacao: "IMPORTAR", motivo: "Evidência sintética conferida" };
const req = (body: unknown, origin = "https://painel.example", tipo = "application/json") => new Request(url, { method: "POST", headers: { origin, "content-type": tipo }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("PAINEL_URL", "https://painel.example");
  mocks.sessao.mockResolvedValue({ usuarioId: "u", papel: "DONO" });
  mocks.prever.mockResolvedValue({ podeAplicar: false }); mocks.consultar.mockResolvedValue({ fonte: { id: "91001" } });
});
afterEach(() => vi.unstubAllEnvs());
describe("rota de histórico", () => {
  it("exige DONO inclusive na leitura e não consulta sem sessão", async () => {
    const r = await GET(new Request(`${url}?transacaoId=91001`));
    expect(r.status).toBe(200); expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.sessao).toHaveBeenCalledWith(["DONO"]);
    mocks.consultar.mockClear(); mocks.sessao.mockRejectedValue(new ErroNegocio("Proibido", 403));
    expect((await GET(new Request(`${url}?transacaoId=91001`))).status).toBe(403); expect(mocks.consultar).not.toHaveBeenCalled();
  });
  it.each([401, 403])("não prevê nem grava quando a sessão é recusada (%s)", async (status) => {
    mocks.sessao.mockRejectedValue(new ErroNegocio("Acesso recusado", status));
    expect((await POST(req({ acao: "prever", escolha }))).status).toBe(status);
    expect((await POST(req({ acao: "aplicar", escolha: { ...escolha, revisao: "a".repeat(64), backupId: "backup" } }))).status).toBe(status);
    expect(mocks.prever).not.toHaveBeenCalled(); expect(mocks.aplicar).not.toHaveBeenCalled();
  });
  it("prévia não chama aplicação e parâmetros financeiros extras são recusados", async () => {
    expect((await POST(req({ acao: "prever", escolha }))).status).toBe(200);
    expect(mocks.sessao).toHaveBeenCalledWith(["DONO"]); expect(mocks.aplicar).not.toHaveBeenCalled();
    expect((await POST(req({ acao: "prever", escolha: { ...escolha, valorCentavos: 1 } }))).status).toBe(400);
  });
  it("não permite aplicação sem revisão ou backup", async () => {
    expect((await POST(req({ acao: "aplicar", escolha }))).status).toBe(400); expect(mocks.aplicar).not.toHaveBeenCalled();
  });
  it("bloqueia origem externa e conteúdo de formulário antes de executar", async () => {
    expect((await POST(req({ acao: "prever", escolha }, "https://externo.example"))).status).toBe(403);
    expect((await POST(req({ acao: "prever", escolha }, "https://painel.example", "text/plain"))).status).toBe(415);
    expect(mocks.prever).not.toHaveBeenCalled(); expect(mocks.aplicar).not.toHaveBeenCalled();
  });
});
