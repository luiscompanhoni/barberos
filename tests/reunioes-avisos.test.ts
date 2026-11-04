import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ permissoes: vi.fn(), criar: vi.fn(), listar: vi.fn(), buscar: vi.fn(), atualizar: vi.fn(), buscarSalvo: vi.fn(), auditar: vi.fn() }));
vi.mock("@/lib/auth/permissoes", () => ({ permissoesDoUsuario: m.permissoes }));
vi.mock("@/lib/auditoria", () => ({ auditar: m.auditar }));
vi.mock("@/lib/db", () => ({ db: {
  avisoReuniao: { findMany: m.listar },
  $transaction: (fn: (tx: unknown) => unknown) => fn({ avisoReuniao: { create: m.criar, findUnique: m.buscar, updateMany: m.atualizar, findUniqueOrThrow: m.buscarSalvo } }),
} }));
import { criarAviso, editarAviso, listarAvisos } from "@/lib/reunioes/avisos";
import type { Sessao } from "@/lib/auth/sessao";
const pessoa = (papel: string) => ({ papel, usuarioId: "u1", barbeiroId: null }) as Sessao;
const aviso = { id: "a1", tipo: "AVISO", texto: "Varrer após o atendimento", concluido: false, versao: 1 };
beforeEach(() => {
  vi.clearAllMocks(); m.permissoes.mockResolvedValue({ reunioes: true }); m.criar.mockResolvedValue(aviso);
  m.buscar.mockResolvedValue(aviso); m.atualizar.mockResolvedValue({ count: 1 }); m.buscarSalvo.mockResolvedValue({ ...aviso, versao: 2 });
});

describe("avisos de reunião", () => {
  it.each(["DONO", "GERENTE", "LIDER"])("permite criar e editar a %s com permissão", async papel => {
    await criarAviso(pessoa(papel), { tipo: "AVISO", texto: aviso.texto });
    await editarAviso(pessoa(papel), "a1", { tipo: "AVISO", texto: aviso.texto, concluido: true, versao: 1 });
    expect(m.criar).toHaveBeenCalledTimes(1); expect(m.atualizar).toHaveBeenCalledTimes(1); expect(m.auditar).toHaveBeenCalledTimes(2);
  });
  it("nega liderança sem permissão e demais papéis mesmo que recebam permissão", async () => {
    m.permissoes.mockResolvedValueOnce({ reunioes: false });
    await expect(listarAvisos(pessoa("LIDER"))).rejects.toMatchObject({ status: 403 });
    await expect(criarAviso(pessoa("RECEPCAO"), { tipo: "AVISO", texto: aviso.texto })).rejects.toMatchObject({ status: 403 });
    expect(m.criar).not.toHaveBeenCalled(); expect(m.listar).not.toHaveBeenCalled();
  });
  it("não sobrescreve alteração concorrente", async () => {
    m.atualizar.mockResolvedValue({ count: 0 });
    await expect(editarAviso(pessoa("LIDER"), "a1", { tipo: "AVISO", texto: aviso.texto, concluido: false, versao: 1 })).rejects.toMatchObject({ status: 409 });
    expect(m.auditar).not.toHaveBeenCalled(); expect(m.buscarSalvo).not.toHaveBeenCalled();
  });
  it("rejeita campos adicionais e texto vazio", async () => {
    await expect(criarAviso(pessoa("LIDER"), { tipo: "AVISO", texto: " ", segredo: true })).rejects.toThrow();
    expect(m.criar).not.toHaveBeenCalled();
  });
});
