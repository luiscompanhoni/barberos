import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ sessao: vi.fn(), listar: vi.fn(), importar: vi.fn() }));
vi.mock("@/lib/auth/sessao", () => ({ exigirSessao: m.sessao }));
vi.mock("@/lib/estudio/roteiros", () => ({ listarRoteiros: m.listar, importarRoteiro: m.importar }));
vi.mock("@/lib/db", () => ({ db: {} }));
import { GET, POST } from "@/app/api/estudio/roteiros/route";
import { ErroNegocio } from "@/lib/erros";
const body = { nome: "Roteiro aprovado", execucaoId: "execucao", revisao: 1, resultadoHash: "a".repeat(64), preset: "black-equipe-v2" };
const req = (dados: unknown = body, headers = {}) => new Request("http://localhost/api/estudio/roteiros", { method: "POST", headers, body: JSON.stringify(dados) });
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("AGENTES_HABILITADOS", "true"); vi.stubEnv("ESTUDIO_HABILITADO", "true"); m.sessao.mockResolvedValue({ usuarioId: "dono" }); });
afterEach(() => vi.unstubAllEnvs());
describe("acesso à ponte Central → Estúdio", () => {
  it.each([401, 403])("sessão negada bloqueia leitura e importação: %s", async status => {
    m.sessao.mockRejectedValue(new ErroNegocio("Negado", status));
    expect((await GET(new Request("http://localhost"))).status).toBe(status); expect((await POST(req())).status).toBe(status);
    expect(m.importar).not.toHaveBeenCalled(); expect(m.listar).not.toHaveBeenCalled();
  });
  it("exige papel DONO e bloqueia origem externa", async () => {
    expect((await POST(req(body, { origin: "https://evil.example", "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect(m.sessao).toHaveBeenCalledWith(["DONO"]); expect(m.importar).not.toHaveBeenCalled();
  });
  it.each(["ESTUDIO_HABILITADO", "AGENTES_HABILITADOS"])("respeita %s desligado", async key => {
    vi.stubEnv(key, "false"); expect((await POST(req())).status).toBe(503); expect(m.importar).not.toHaveBeenCalled();
  });
  it("cliente não pode trocar proprietário nem enviar script como campo extra", async () => {
    expect((await POST(req({ ...body, usuarioId: "outro" }))).status).toBe(400); expect(m.importar).not.toHaveBeenCalled();
  });
  it("reutilização devolve 200, criação 201, sem cache privado", async () => {
    m.importar.mockResolvedValue({ id: "p", reutilizado: false });
    const criado = await POST(req()); expect(criado.status).toBe(201); expect(criado.headers.get("cache-control")).toBe("private, no-store");
    expect(m.importar).toHaveBeenCalledWith("dono", body);
    m.importar.mockResolvedValue({ id: "p", reutilizado: true }); expect((await POST(req())).status).toBe(200);
  });
});
