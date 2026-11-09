import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErroNegocio } from "@/lib/erros";
const m = vi.hoisted(() => ({ sessao: vi.fn(), criar: vi.fn() }));
vi.mock("@/lib/auth/sessao", () => ({ exigirSessao: m.sessao }));
vi.mock("@/lib/auth/permissoes", () => ({ exigirSessaoCom: vi.fn() }));
vi.mock("@/lib/dominios", () => ({ urlPainel: () => "https://painel.exemplo.test" }));
vi.mock("@/lib/rh/funcionarios", () => ({ listarFuncionarios: vi.fn(), salvarFicha: vi.fn() }));
vi.mock("@/lib/rh/cadastro", async () => ({ ...await vi.importActual<typeof import("@/lib/rh/cadastro")>("@/lib/rh/cadastro"), criarPessoaRh: m.criar }));
import { POST } from "@/app/api/rh/funcionarios/route";
const dados = { nome: "Pessoa fictícia", telefone: "11987650001", cargo: "Sócio", salarioCentavos: 120000, competenciaSalario: "2032-01", idempotencia: "ee369992-27a3-48e7-8c30-d90c6a48f183" };
const req = (body: unknown = dados, headers: Record<string, string> = {}) => new Request("https://painel.exemplo.test/api/rh/funcionarios", { method: "POST", headers: { "content-type": "application/json", origin: "https://painel.exemplo.test", ...headers }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); m.sessao.mockResolvedValue({ usuarioId: "dono-ficticio", papel: "DONO" }); m.criar.mockResolvedValue({ pessoaId: "pessoa-ficticia", jaRegistrada: false }); });
describe("cadastro exclusivo no RH", () => {
  it("exige sessão de dono e mantém resposta privada", async () => { const r = await POST(req()); expect(r.status).toBe(201); expect(m.sessao).toHaveBeenCalledWith(["DONO"]); expect(r.headers.get("cache-control")).toBe("private, no-store"); });
  it("não escreve para sessão ausente", async () => { m.sessao.mockRejectedValue(new ErroNegocio("Entre no sistema", 401)); expect((await POST(req())).status).toBe(401); expect(m.criar).not.toHaveBeenCalled(); });
  it("rejeita origem externa, corpo não JSON e campos de acesso/checklist", async () => {
    expect((await POST(req(dados, { origin: "https://externo.test" }))).status).toBe(403);
    expect((await POST(req(dados, { "content-type": "text/plain" }))).status).toBe(415);
    expect((await POST(req({ ...dados, papel: "DONO", funcao: "GERENTE" }))).status).toBe(400);
    expect(m.criar).not.toHaveBeenCalled();
  });
});
