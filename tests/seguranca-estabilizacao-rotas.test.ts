import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ trocar: vi.fn(), reset: vi.fn(), abrir: vi.fn() }));
vi.mock("@/lib/auth/acesso", () => ({ trocarPropriaSenha: m.trocar, redefinirSenhaTemporaria: m.reset, normalizarLogin: (s: string) => s }));
vi.mock("@/lib/auth/abrir-sessao", () => ({ abrirSessao: m.abrir }));
vi.mock("@/lib/auth/sessao", () => ({ EQUIPE: ["DONO"], exigirSessao: async () => ({ usuarioId: "fixture-dono", papel: "DONO", sessaoVersao: 4 }) }));
vi.mock("@/lib/auth/equipe", () => ({ opcoesDeAcesso: vi.fn(), salvarAcesso: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { usuario: { update: vi.fn() } } }));
import { PATCH as propria } from "@/app/api/auth/minha-senha/route";
import { PATCH as equipe } from "@/app/api/usuarios/[id]/route";
import { ErroNegocio } from "@/lib/erros";
import { _zerarLimites } from "@/lib/limite";
const renovado = { id: "fixture-dono", papel: "DONO", sessaoVersao: 5 };
beforeEach(() => {
  vi.clearAllMocks(); _zerarLimites(); vi.stubEnv("SITE_URL", "https://fixture.test"); vi.stubEnv("PAINEL_URL", "https://fixture.test");
  m.trocar.mockResolvedValue(renovado); m.reset.mockResolvedValue({ senha: "fixture-temporaria", usuario: renovado });
});
afterEach(() => vi.unstubAllEnvs());
const req = (dados: unknown) => new Request("https://fixture.test/api/auth/minha-senha", { method: "PATCH", headers: { "content-type": "application/json", origin: "https://fixture.test" }, body: JSON.stringify(dados) });

it("renova a sessão solicitante com a versão retornada pela troca já confirmada", async () => {
  expect((await propria(req({ atual: "fixture-anterior", nova: "fixture-nova" }))).status).toBe(200);
  expect(m.trocar).toHaveBeenCalledWith("fixture-dono", { atual: "fixture-anterior", nova: "fixture-nova" }, 4);
  expect(m.abrir).toHaveBeenCalledWith(renovado);
});
it("não emite sessão nova quando a mudança de senha falha", async () => {
  m.trocar.mockRejectedValue(new ErroNegocio("Senha atual incorreta", 401));
  expect((await propria(req({ atual: "fixture-errada", nova: "fixture-nova" }))).status).toBe(401);
  expect(m.abrir).not.toHaveBeenCalled();
});
it("reset da própria conta preserva somente a sessão renovada e não permite cache da senha", async () => {
  const r = await equipe(req({ acao: "senha_temporaria" }), { params: Promise.resolve({ id: "fixture-dono" }) });
  expect(r.status).toBe(200); expect(r.headers.get("cache-control")).toBe("private, no-store");
  expect(m.reset).toHaveBeenCalledWith("fixture-dono", expect.objectContaining({ usuarioId: "fixture-dono", sessaoVersao: 4 }));
  expect(m.abrir).toHaveBeenCalledWith(renovado);
  expect(await r.json()).toEqual({ senha: "fixture-temporaria" });
});
it("reset de outro profissional não troca a identidade do dono que executou a ação", async () => {
  expect((await equipe(req({ acao: "senha_temporaria" }), { params: Promise.resolve({ id: "fixture-outro" }) })).status).toBe(200);
  expect(m.abrir).not.toHaveBeenCalled();
});
