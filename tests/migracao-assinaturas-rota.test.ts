import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErroNegocio } from "@/lib/erros";

const m = vi.hoisted(() => ({ sessao: vi.fn(), listar: vi.fn(), registrar: vi.fn() }));
vi.mock("@/lib/auth/sessao", () => ({ GESTAO: ["DONO", "GERENTE"], exigirSessao: m.sessao }));
vi.mock("@/lib/migracao-assinaturas/servico", () => ({ listarQuadroMigracao: m.listar, registrarMigracao: m.registrar }));
import { GET, POST } from "@/app/api/migracao-assinaturas/route";

beforeEach(() => {
  vi.clearAllMocks(); m.sessao.mockResolvedValue({ usuarioId: "gerente", papel: "GERENTE" });
  m.listar.mockResolvedValue({ linhas: [], total: 0, automacaoAtiva: false }); m.registrar.mockResolvedValue({ assinaturaId: "teste" });
});
describe("rota protegida do quadro", () => {
  it("consulta autenticada é somente leitura", async () => {
    const resposta = await GET(new Request("http://localhost/api/migracao-assinaturas?estado=AJUDA&responsavelId=gerente"));
    expect(resposta.status).toBe(200); expect(m.sessao).toHaveBeenCalledWith(["DONO", "GERENTE"]);
    expect(m.listar).toHaveBeenCalledWith({ estado: "AJUDA", responsavelId: "gerente" }); expect(m.registrar).not.toHaveBeenCalled();
  });
  it("não retorna inventário nem grava quando a sessão é proibida", async () => {
    m.sessao.mockRejectedValue(new ErroNegocio("Acesso proibido.", 403));
    expect((await GET(new Request("http://localhost/api/migracao-assinaturas"))).status).toBe(403);
    expect((await POST(new Request("http://localhost/api/migracao-assinaturas", { method: "POST", body: JSON.stringify({ acao: "iniciar", assinaturaId: "teste" }) }))).status).toBe(403);
    expect(m.listar).not.toHaveBeenCalled(); expect(m.registrar).not.toHaveBeenCalled();
  });
  it("rejeita estados desconhecidos e corpo contendo campos extras", async () => {
    expect((await GET(new Request("http://localhost/api/migracao-assinaturas?estado=COBRAR"))).status).toBe(400);
    const resposta = await POST(new Request("http://localhost/api/migracao-assinaturas", { method: "POST", body: JSON.stringify({ acao: "iniciar", assinaturaId: "teste", cartao: "não permitido" }) }));
    expect(resposta.status).toBe(400); expect(m.registrar).not.toHaveBeenCalled();
  });
  it("início válido registra apenas o controle interno", async () => {
    expect((await POST(new Request("http://localhost/api/migracao-assinaturas", { method: "POST", body: JSON.stringify({ acao: "iniciar", assinaturaId: "teste" }) }))).status).toBe(200);
    expect(m.registrar).toHaveBeenCalledWith({ usuarioId: "gerente", papel: "GERENTE" }, { acao: "iniciar", assinaturaId: "teste" });
  });
});
