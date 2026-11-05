import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ sessao: vi.fn(), cliente: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() }, usuario: { update: vi.fn(), findUnique: vi.fn() }, audit: vi.fn() }));
vi.mock("@/lib/auth/sessao", () => ({ exigirCliente: m.sessao }));
vi.mock("@/lib/db", () => ({ db: { cliente: m.cliente, $transaction: (fn: (tx: unknown) => unknown) => fn({ $executeRaw: vi.fn(), $queryRaw: vi.fn(), cliente: m.cliente, usuario: m.usuario }) } }));
vi.mock("@/lib/auditoria", () => ({ auditar: m.audit }));
import { GET, PATCH } from "@/app/api/cliente/perfil/route";
import { GET as foto, PUT, DELETE } from "@/app/api/cliente/foto/route";
import { ErroNegocio } from "@/lib/erros";
const perfil = { nome: "Cliente", telefone: "5547999990000", cpf: "52998224725", email: "cliente@example.test", endereco: "Rua de Teste, 100", dataNascimento: new Date("1990-06-20"), fotoVersao: 1, perfilCompletoEm: null };
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("SITE_URL", "https://cliente.example.test"); m.sessao.mockResolvedValue({ clienteId: "c1", usuarioId: "u1" }); m.cliente.findUniqueOrThrow.mockResolvedValue(perfil); m.cliente.findUnique.mockResolvedValue({ ...perfil, usuarioId: "u1", excluidoEm: null }); m.usuario.findUnique.mockResolvedValue({ id: "u1", ativo: true, papel: "CLIENTE", sessaoVersao: 0 }); m.cliente.update.mockResolvedValue({ nome: "Nome Novo" }); });
afterEach(() => vi.unstubAllEnvs());
const req = (body: unknown, origem = "https://cliente.example.test") => new Request("https://cliente.example.test/api/cliente/perfil", { method: "PATCH", headers: { origin: origem, "content-type": "application/json" }, body: JSON.stringify(body) });

describe("perfil e foto privados", () => {
  it("consulta mascara CPF e não devolve bytes de foto", async () => {
    const r = await GET(); const d = await r.json();
    expect(d.cpf).toBeUndefined(); expect(d.cpfMascarado).toBe("***.***.***-25"); expect(d.fotoDados).toBeUndefined();
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(m.cliente.findUniqueOrThrow).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "c1" } }));
  });
  it("nega edição de outra origem antes de gravar", async () => {
    expect((await PATCH(req({ nome: "Outro Nome" }, "https://evil.example.test"))).status).toBe(403);
    expect(m.cliente.update).not.toHaveBeenCalled();
  });
  it("não aceita troca de telefone nem usuário por edição de perfil", async () => {
    expect((await PATCH(req({ telefone: "5547999991111", usuarioId: "other" }))).status).toBe(400);
    expect(m.cliente.update).not.toHaveBeenCalled();
  });
  it("atualiza nome nas duas tabelas com auditoria de campos, sem valores pessoais", async () => {
    const r = await PATCH(req({ nome: "Nome Novo" })); expect(r.status).toBe(200);
    expect(m.usuario.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { nome: "Nome Novo" } });
    expect(m.audit).toHaveBeenCalledWith(expect.anything(), "u1", "cliente_atualizar_perfil", "cliente", "c1", { campos: ["nome"] });
  });
  it("foto exige sessão e só consulta o próprio cliente", async () => {
    m.sessao.mockRejectedValueOnce(new ErroNegocio("Entre", 401)); expect((await foto()).status).toBe(401);
    m.cliente.findUnique.mockResolvedValue({ fotoDados: new Uint8Array([1, 2]), fotoTipo: "image/png" });
    const r = await foto(); expect(r.status).toBe(200); expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(m.cliente.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "c1" } }));
  });
  it("recusa SVG ou cabeçalho incompatível sem persistir", async () => {
    const r = await PUT(new Request("https://cliente.example.test/api/cliente/foto", { method: "PUT", headers: { origin: "https://cliente.example.test" }, body: JSON.stringify({ dataUrl: "data:image/png;base64,PGh0bWw+" }) }));
    expect(r.status).toBe(422); expect(m.cliente.update).not.toHaveBeenCalled();
  });
  it.each([{ ativo: false }, { sessaoVersao: 1 }, { papel: "RECEPCAO" }])("revalida o usuário sob lock antes de editar %#", async (mudanca) => {
    m.usuario.findUnique.mockResolvedValue({ id: "u1", ativo: true, papel: "CLIENTE", sessaoVersao: 0, ...mudanca });
    expect((await PATCH(req({ nome: "Não gravar" }))).status).toBe(401);
    expect(m.cliente.update).not.toHaveBeenCalled(); expect(m.usuario.update).not.toHaveBeenCalled();
  });
  it.each([{ excluidoEm: new Date() }, { usuarioId: "outro" }])("exclusão ou vínculo alterado impede perfil e foto %#", async (mudanca) => {
    m.cliente.findUnique.mockResolvedValue({ ...perfil, usuarioId: "u1", ...mudanca });
    expect((await PATCH(req({ nome: "Não restaurar" }))).status).toBe(401);
    expect((await DELETE(req({}))).status).toBe(401);
    expect(m.cliente.update).not.toHaveBeenCalled();
  });
});
