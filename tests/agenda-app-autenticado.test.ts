import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { checarTransicaoNaReserva, type AgendaApp } from "@/lib/agenda/transicao";

const m = { cliente: vi.fn(), usuario: vi.fn(), cfg: vi.fn(), lock: vi.fn() };
const tx = { cliente: { findUnique: m.cliente }, usuario: { findUnique: m.usuario }, configuracao: { findUnique: m.cfg }, $executeRaw: m.lock } as unknown as Prisma.TransactionClient;
const app: AgendaApp = { clienteId: "c", titular: { usuarioId: "u", sessaoVersao: 4 } };
beforeEach(() => {
  vi.clearAllMocks();
  m.cliente.mockResolvedValue({ id: "c", usuarioId: "u", excluidoEm: null });
  m.usuario.mockResolvedValue({ id: "u", ativo: true, papel: "CLIENTE", sessaoVersao: 4 });
  m.cfg.mockResolvedValue({ agendaExternaAtiva: true });
});

describe("confirmação direta restrita ao app autenticado", () => {
  it("permite o app com sessão atual e vínculo conferido sob trava, sem mudar a configuração", async () => {
    await expect(checarTransicaoNaReserva(tx, app)).resolves.toBeUndefined();
    expect(m.lock.mock.calls.map(c => c[1])).toEqual(["auth-usuario:u", "cliente-ciclo:c", undefined]);
    expect(m.cliente).toHaveBeenCalledWith({ where: { id: "c" } });
    expect(m.usuario).toHaveBeenCalledWith({ where: { id: "u" } });
    expect(m.cfg).toHaveBeenCalledOnce();
  });
  it("mantém o bloqueio do bot e de callers SITE sem contexto autenticado", async () => {
    await expect(checarTransicaoNaReserva(tx)).rejects.toMatchObject({ codigo: "confirmacao_equipe" });
    expect(m.cliente).not.toHaveBeenCalled(); expect(m.usuario).not.toHaveBeenCalled();
  });
  it.each([{ ativo: false }, { papel: "DONO" }, { sessaoVersao: 5 }])("recusa sessão alterada antes da exceção %#", async mudanca => {
    m.usuario.mockResolvedValue({ id: "u", ativo: true, papel: "CLIENTE", sessaoVersao: 4, ...mudanca });
    await expect(checarTransicaoNaReserva(tx, app)).rejects.toMatchObject({ codigo: "sessao_invalida" });
    expect(m.cfg).not.toHaveBeenCalled();
  });
  it.each([{ usuarioId: "outra-pessoa" }, { excluidoEm: new Date() }])("recusa vínculo divergente ou cliente excluído %#", async mudanca => {
    m.cliente.mockResolvedValue({ id: "c", usuarioId: "u", excluidoEm: null, ...mudanca });
    await expect(checarTransicaoNaReserva(tx, app)).rejects.toMatchObject({ status: "excluidoEm" in mudanca ? 404 : 401 });
    expect(m.cfg).not.toHaveBeenCalled();
  });
  it("não aceita um contexto interno incompleto como autorização", async () => {
    await expect(checarTransicaoNaReserva(tx, { clienteId: "c" } as AgendaApp)).rejects.toMatchObject({ codigo: "sessao_invalida" });
    expect(m.lock).not.toHaveBeenCalled();
  });
});
