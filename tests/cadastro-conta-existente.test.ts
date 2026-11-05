import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ usuario: vi.fn(), cliente: vi.fn(), criar: vi.fn(), atualizar: vi.fn(), hash: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { usuario: { findUnique: m.usuario, create: m.criar, update: m.atualizar }, cliente: { findUnique: m.cliente } } }));
vi.mock("@/lib/auth/senha", () => ({ problemaDaSenha: () => null, gerarHash: m.hash }));
import { criarContaCliente } from "@/lib/auth/acesso";
beforeEach(() => { vi.clearAllMocks(); m.usuario.mockResolvedValue(null); m.cliente.mockResolvedValue(null); });
describe("cadastro não toma conta existente sem senha", () => {
  it("exige prova para usuário social sem senha", async () => {
    m.usuario.mockResolvedValue({ id: "u1", papel: "CLIENTE", senhaHash: null });
    await expect(criarContaCliente({ nome: "Outra Pessoa", telefone: "47999990000", senha: "senha-fornecida", codigo: "" })).rejects.toMatchObject({ codigo: "confirmar_celular" });
    expect(m.hash).not.toHaveBeenCalled(); expect(m.criar).not.toHaveBeenCalled(); expect(m.atualizar).not.toHaveBeenCalled();
  });
  it("não substitui vínculo preexistente no cadastro mesmo sem usuário encontrado pelo número", async () => {
    m.cliente.mockResolvedValue({ usuarioId: "dono-do-cadastro", _count: { agendamentos: 0, assinaturas: 0 } });
    await expect(criarContaCliente({ nome: "Outra Pessoa", telefone: "47999990000", senha: "senha-fornecida", codigo: "" })).rejects.toMatchObject({ codigo: "confirmar_celular" });
    expect(m.hash).not.toHaveBeenCalled(); expect(m.criar).not.toHaveBeenCalled();
  });
});
