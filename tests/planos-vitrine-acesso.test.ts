import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErroNegocio } from "@/lib/erros";
const m = vi.hoisted(() => ({ auth: vi.fn(), find: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/auth/sessao", () => ({ exigirSessao: m.auth, EQUIPE: ["DONO", "GERENTE", "LIDER", "RECEPCAO", "BARBEIRO"], GESTAO: ["DONO", "GERENTE"] }));
vi.mock("@/lib/db", () => ({ db: { plano: { findMany: m.find, create: m.create } } }));
vi.mock("@/lib/assinaturas/servico", () => ({ vagasRestantes: vi.fn() }));
import { GET, POST } from "@/app/api/planos/route";

beforeEach(() => { vi.clearAllMocks(); });
describe("permissões dos planos", () => {
  it("cliente não consulta o cadastro administrativo de planos ocultos", async () => {
    m.auth.mockRejectedValue(new ErroNegocio("Sem acesso", 403));
    expect((await GET()).status).toBe(403); expect(m.find).not.toHaveBeenCalled();
    expect(m.auth).toHaveBeenCalledWith(expect.not.arrayContaining(["CLIENTE"]));
  });
  it("não permite cadastro sem papel de gestão", async () => {
    m.auth.mockRejectedValue(new ErroNegocio("Sem acesso", 403));
    expect((await POST(new Request("http://local/api/planos", { method: "POST", body: "{}" }))).status).toBe(403);
    expect(m.create).not.toHaveBeenCalled();
    expect(m.auth).toHaveBeenCalledWith(["DONO", "GERENTE"]);
  });
});
