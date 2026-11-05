import { beforeEach, describe, expect, it, vi } from "vitest";
import { zClienteGestao, zConsultaClientes, zEditarClienteGestao, filtroClientes, cpfMascarado } from "@/lib/clientes/gestao-regras";
const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), usuarioUpdate: vi.fn(), audit: vi.fn(), lock: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { $transaction: vi.fn((f) => f({
  cliente: { findFirst: mocks.findFirst, create: mocks.create, update: mocks.update },
  usuario: { updateMany: mocks.usuarioUpdate }, $queryRaw: mocks.lock, $executeRaw: vi.fn(),
})) } }));
vi.mock("@/lib/auditoria", () => ({ auditar: mocks.audit }));
import { cadastrarCliente, editarCliente } from "@/lib/clientes/gestao";

const exemplo = { id: "cliente-teste", nome: "Cliente Demonstração", telefone: "5511999990000", email: null, cpf: "52998224725",
  endereco: null, dataNascimento: null, observacoes: null, usuarioId: null as string | null, criadoEm: new Date(), fotoVersao: 0, perfilCompletoEm: null };
beforeEach(() => { vi.clearAllMocks(); mocks.findFirst.mockResolvedValue(exemplo); mocks.create.mockResolvedValue(exemplo); mocks.update.mockResolvedValue(exemplo); });

describe("Gestão de clientes: filtros e validação", () => {
  it("exclui cadastros apagados e não busca telefone por fragmentos curtos", () => {
    const f = filtroClientes(zConsultaClientes.parse({ busca: "12" }));
    expect(f.excluidoEm).toBeNull();
    expect(f.OR).toHaveLength(2);
  });
  it("permite CPF exato sem pesquisa parcial indiscriminada", () => {
    const f = filtroClientes(zConsultaClientes.parse({ busca: "529.982.247-25", plano: "sem_plano" }));
    expect(f.OR).toContainEqual({ cpf: "52998224725" });
    expect(f.assinaturas).toEqual({ none: { status: { in: ["ATIVA", "ATRASADA"] } } });
    expect(cpfMascarado("52998224725")).not.toContain("52998224725");
  });
  it("recusa paginação inválida, campos privilegiados e CPF inválido", () => {
    expect(zConsultaClientes.safeParse({ pagina: -1 }).success).toBe(false);
    expect(zClienteGestao.safeParse({ nome: "Teste", telefone: "11999990000", usuarioId: "dono" }).success).toBe(false);
    expect(zClienteGestao.safeParse({ nome: "Teste", telefone: "11999990000", cpf: "11111111111" }).success).toBe(false);
    expect(zEditarClienteGestao.safeParse({}).success).toBe(false);
  });
});

describe("Gestão de clientes: persistência e identidade", () => {
  it("cria sem opt-in promocional e sem expor CPF ou vínculo de autenticação", async () => {
    const c = await cadastrarCliente({ nome: exemplo.nome, telefone: exemplo.telefone }, "recepcao");
    expect(mocks.create.mock.calls[0][0].data.aceitaMensagens).toBe(false);
    expect(c).not.toHaveProperty("cpf"); expect(c).not.toHaveProperty("usuarioId");
    expect(mocks.audit.mock.calls[0][5]).not.toHaveProperty("cpf");
  });
  it("impede trocar telefone que dá acesso e não atualiza login silenciosamente", async () => {
    mocks.findFirst.mockResolvedValue({ ...exemplo, usuarioId: "usuario-cliente" });
    await expect(editarCliente(exemplo.id, { telefone: "5511988880000" }, "recepcao")).rejects.toMatchObject({ codigo: "telefone_com_acesso" });
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.usuarioUpdate).not.toHaveBeenCalled();
  });
  it("sincroniza nome somente na conta CLIENTE, sob trava", async () => {
    mocks.findFirst.mockResolvedValue({ ...exemplo, usuarioId: "usuario-cliente" });
    await editarCliente(exemplo.id, { nome: "Nome corrigido" }, "recepcao");
    expect(mocks.lock).toHaveBeenCalledOnce();
    expect(mocks.usuarioUpdate).toHaveBeenCalledWith({ where: { id: "usuario-cliente", papel: "CLIENTE" }, data: { nome: "Nome corrigido" } });
  });
  it("não recria nem edita cadastro excluído", async () => {
    mocks.findFirst.mockResolvedValue(null);
    await expect(editarCliente(exemplo.id, { nome: "Outro" }, "recepcao")).rejects.toMatchObject({ status: 404 });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("não usa um vínculo que mudou enquanto aguardava a trava", async () => {
    mocks.findFirst.mockResolvedValueOnce(exemplo).mockResolvedValueOnce({ ...exemplo, usuarioId: "conta-nova" });
    await expect(editarCliente(exemplo.id, { nome: "Outro" }, "recepcao")).rejects.toMatchObject({ status: 409 });
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.usuarioUpdate).not.toHaveBeenCalled();
  });
});
