import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ usuario: vi.fn(), perfil: vi.fn(), atualizar: vi.fn(), hash: vi.fn(), otp: vi.fn(), conferir: vi.fn(), tx: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: m.tx } }));
vi.mock("@/lib/auth/senha", () => ({ problemaDaSenha: () => null, gerarHash: m.hash, conferirSenha: m.conferir }));
vi.mock("@/lib/auth/otp", () => ({ verificarCodigo: m.otp }));
import { criarContaCliente, trocarPropriaSenha } from "@/lib/auth/acesso";
const dados = { nome: "Dono do celular", telefone: "47999990000", senha: "senha-fornecida", codigo: "123456" };
const usuario = { id: "u1", ativo: true, papel: "CLIENTE", telefone: "5547999990000", telefoneVerificadoEm: new Date(), sessaoVersao: 1, senhaHash: null, cliente: { id: "c1", excluidoEm: null } };
beforeEach(() => {
  vi.resetAllMocks(); m.hash.mockResolvedValue("hash-seguro"); m.otp.mockResolvedValue(usuario); m.usuario.mockResolvedValue(usuario);
  m.tx.mockImplementation((fn: (tx: unknown) => unknown) => fn({ $executeRaw: vi.fn(), usuario: { findUnique: m.usuario, findUniqueOrThrow: m.usuario, update: m.atualizar }, cliente: { update: m.perfil } }));
});

describe("cadastro exige prova antes de criar credenciais", () => {
  it("número digitado sem OTP não cria senha nem vincula conta sem senha", async () => {
    await expect(criarContaCliente({ ...dados, codigo: "" })).rejects.toMatchObject({ codigo: "confirmar_celular" });
    expect(m.otp).not.toHaveBeenCalled(); expect(m.hash).not.toHaveBeenCalled(); expect(m.tx).not.toHaveBeenCalled();
  });
  it("código inválido impede qualquer escrita de credencial ou perfil", async () => {
    m.otp.mockRejectedValue(new Error("Código inválido"));
    await expect(criarContaCliente(dados)).rejects.toThrow("inválido");
    expect(m.hash).not.toHaveBeenCalled(); expect(m.tx).not.toHaveBeenCalled();
  });
  it("depois da prova cria senha para o titular sem duplicar sua ficha", async () => {
    await criarContaCliente(dados);
    expect(m.otp).toHaveBeenCalledWith("5547999990000", "123456", "cliente", "acesso", { permitirNovoCadastro: true });
    expect(m.atualizar).toHaveBeenCalledWith({ where: { id: "u1" }, data: { nome: dados.nome, senhaHash: "hash-seguro", trocarSenha: false } });
    expect(m.perfil).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "c1" } }));
  });
  it("não substitui senha previamente verificada pelo formulário público", async () => {
    m.usuario.mockResolvedValue({ ...usuario, senhaHash: "senha-legitima" });
    await expect(criarContaCliente(dados)).rejects.toMatchObject({ codigo: "ja_tem_conta" });
    expect(m.atualizar).not.toHaveBeenCalled();
  });
  it("não transforma funcionário em cliente", async () => {
    m.otp.mockResolvedValue({ ...usuario, papel: "DONO" });
    await expect(criarContaCliente(dados)).rejects.toMatchObject({ status: 403 });
    expect(m.atualizar).not.toHaveBeenCalled(); expect(m.tx).not.toHaveBeenCalled();
  });
  it("recusa prova revogada antes de salvar a senha", async () => {
    m.usuario.mockResolvedValue({ ...usuario, sessaoVersao: 2 });
    await expect(criarContaCliente(dados)).rejects.toMatchObject({ status: 401 });
    expect(m.atualizar).not.toHaveBeenCalled();
  });
});

describe("definição de senha não recupera sessão revogada", () => {
  it("revalida a versão sob bloqueio antes de tratar conta sem senha", async () => {
    await expect(trocarPropriaSenha("u1", { nova: "nova-senha-segura" }, 0)).rejects.toMatchObject({ status: 401 });
    expect(m.hash).not.toHaveBeenCalled(); expect(m.atualizar).not.toHaveBeenCalled();
  });
  it("sessão legada não verificada precisa comprovar o celular", async () => {
    m.usuario.mockResolvedValue({ ...usuario, sessaoVersao: 0, telefoneVerificadoEm: null });
    await expect(trocarPropriaSenha("u1", { nova: "nova-senha-segura" }, 0)).rejects.toMatchObject({ codigo: "confirmar_celular" });
    expect(m.atualizar).not.toHaveBeenCalled();
  });
  it("sessão emitida após a prova pode definir senha opcional", async () => {
    await trocarPropriaSenha("u1", { nova: "nova-senha-segura" }, 1);
    expect(m.atualizar).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ senhaHash: "hash-seguro" }) }));
  });
});
