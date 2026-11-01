import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ exigir: vi.fn(), listar: vi.fn(), criar: vi.fn(), projeto: vi.fn(), upload: vi.fn() }));
vi.mock("@/lib/auth/sessao", () => ({ exigirSessao: m.exigir }));
vi.mock("@/lib/estudio/servico", () => ({ listar: m.listar, criar: m.criar, projeto: m.projeto, publico: vi.fn(), iniciarUpload: m.upload, concluirUpload: vi.fn(), excluirClipe: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
import { GET, POST } from "@/app/api/estudio/projetos/route";
import { GET as video, PUT } from "@/app/api/estudio/projetos/[id]/clipes/[clipeId]/route";
import { exigirWorker, json } from "@/lib/estudio/http";
import { zProjeto } from "@/lib/estudio/regras";
import { ErroNegocio } from "@/lib/erros";
const request = (method = "GET", headers = {}) => new Request("http://localhost/api/estudio/projetos", { method, headers, ...(method === "POST" ? { body: JSON.stringify({ nome: "Teste" }) } : {}) });
beforeEach(() => { vi.resetAllMocks(); process.env.ESTUDIO_HABILITADO = "true"; });
afterEach(() => { delete process.env.ESTUDIO_HABILITADO; delete process.env.ESTUDIO_WORKER_TOKEN; });
describe("barreiras de acesso do Estúdio", () => {
  it.each([401, 403])("bloqueia sem sessão da equipe: %s", async status => {
    m.exigir.mockRejectedValue(new ErroNegocio("Sem acesso", status));
    expect((await GET(request())).status).toBe(status);
    expect((await POST(request("POST"))).status).toBe(status);
    const ctx = { params: Promise.resolve({ id: "p", clipeId: "c" }) };
    expect((await video(request(), ctx)).status).toBe(status);
    expect((await PUT(new Request("http://localhost", { method: "PUT", body: "x" }), ctx)).status).toBe(status);
    expect(m.listar).not.toHaveBeenCalled(); expect(m.upload).not.toHaveBeenCalled(); expect(m.projeto).not.toHaveBeenCalled();
  });
  it("feature desligada não consulta banco", async () => {
    process.env.ESTUDIO_HABILITADO = "false";
    expect((await GET(request())).status).toBe(503); expect(m.exigir).not.toHaveBeenCalled();
  });
  it("rejeita submissão de outra origem", async () => {
    m.exigir.mockResolvedValue({ usuarioId: "u" });
    expect((await POST(request("POST", { origin: "https://outro.example", "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect(m.criar).not.toHaveBeenCalled();
  });
  it("usa o usuário da sessão na lista", async () => {
    m.exigir.mockResolvedValue({ usuarioId: "u" }); m.listar.mockResolvedValue({ projetos: [] });
    const r = await GET(request()); expect(r.headers.get("cache-control")).toContain("no-store");
    expect(m.listar).toHaveBeenCalledWith("u");
  });
  it("token de worker é obrigatório, forte e comparado por inteiro", () => {
    expect(() => exigirWorker(request())).toThrow();
    process.env.ESTUDIO_WORKER_TOKEN = "a".repeat(32);
    expect(() => exigirWorker(request("GET", { authorization: "Bearer " + "b".repeat(32) }))).toThrow();
    expect(() => exigirWorker(request("GET", { authorization: "Bearer " + "a".repeat(32) }))).not.toThrow();
  });
  it("limita JSON por bytes sem depender de Content-Length", async () => {
    await expect(json(new Request("http://localhost", { method: "POST", body: "x".repeat(32769) }), zProjeto)).rejects.toMatchObject({ status: 413 });
  });
});
