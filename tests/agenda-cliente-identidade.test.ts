import { beforeEach, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { resolverClienteAgenda, travarClienteAgenda } from "@/lib/agenda/cliente-identidade";
const m = { cliente: vi.fn(), criar: vi.fn(), usuario: vi.fn(), lock: vi.fn() };
const tx = { cliente: { findUnique: m.cliente, create: m.criar }, usuario: { findUnique: m.usuario }, $executeRaw: m.lock } as unknown as Prisma.TransactionClient;
beforeEach(() => {
  vi.clearAllMocks(); m.cliente.mockResolvedValue({ id: "c", usuarioId: "u", excluidoEm: null });
  m.usuario.mockResolvedValue({ id: "u", ativo: true, papel: "CLIENTE", sessaoVersao: 3 });
});
it("usa ID estável e trava usuário antes do ciclo de vida, sem upsert de telefone", async () => {
  expect(await resolverClienteAgenda(tx, { id: "c" }, { usuarioId: "u", sessaoVersao: 3 })).toBe("c");
  expect(m.lock.mock.calls.map(c => c[1])).toEqual(["auth-usuario:u", "cliente-ciclo:c"]);
  expect(m.cliente).toHaveBeenCalledWith({ where: { id: "c" } }); expect(m.criar).not.toHaveBeenCalled();
});
it.each([null, { id: "c", usuarioId: "u", excluidoEm: new Date() }])("não recria um cliente removido ou excluído %#", async (c) => {
  m.cliente.mockResolvedValue(c);
  await expect(resolverClienteAgenda(tx, { id: "c" }, { usuarioId: "u", sessaoVersao: 3 })).rejects.toMatchObject({ status: 404 });
  expect(m.criar).not.toHaveBeenCalled();
});
it.each([{ ativo: false }, { sessaoVersao: 4 }, { papel: "DONO" }])("revalida a sessão depois da espera %#", async (mudanca) => {
  m.usuario.mockResolvedValue({ id: "u", ativo: true, papel: "CLIENTE", sessaoVersao: 3, ...mudanca });
  await expect(travarClienteAgenda(tx, "c", { usuarioId: "u", sessaoVersao: 3 })).rejects.toMatchObject({ codigo: "sessao_invalida" });
});
it("não aceita autenticação que voltou a resolver cliente por telefone", async () => {
  await expect(resolverClienteAgenda(tx, { telefone: "11999990000", nome: "Anterior" }, { usuarioId: "u", sessaoVersao: 3 })).rejects.toMatchObject({ status: 401 });
  expect(m.cliente).not.toHaveBeenCalled(); expect(m.criar).not.toHaveBeenCalled();
});
it("fluxo sem sessão resolve cadastro existente com ordem telefone → ciclo", async () => {
  expect(await resolverClienteAgenda(tx, { telefone: "11999990000", nome: "Cliente" })).toBe("c");
  expect(m.lock.mock.calls.map(c => c[1])).toEqual(["cliente-ciclo-telefone:5511999990000", "cliente-ciclo:c"]);
  expect(m.criar).not.toHaveBeenCalled();
});
