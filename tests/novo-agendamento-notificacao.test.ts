import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Agendamento, Prisma } from "@prisma/client";
const m = vi.hoisted(() => ({ publicar: vi.fn(), barbeiro: vi.fn() }));
vi.mock("@/lib/notificacoes/caixa", () => ({ publicarNotificacao: m.publicar }));
import { notificarNovoAgendamento } from "@/lib/notificacoes/novo-agendamento";
const tx = { barbeiro: { findUnique: m.barbeiro } } as unknown as Prisma.TransactionClient;
const ag = (extra = {}) => ({ id: "reserva", barbeiroId: "b1", adicionalDeId: null, status: "MARCADO", inicio: new Date(Date.now() + 1_800_000), fim: new Date(Date.now() + 3_600_000), ...extra } as Agendamento);
beforeEach(() => { vi.clearAllMocks(); m.barbeiro.mockResolvedValue({ ativo: true, usuarioId: "profissional" }); });
describe("avisos privados de novas reservas", () => {
  it("grava um aviso com chave estável para o usuário do barbeiro na transação da reserva", async () => {
    await notificarNovoAgendamento(tx, ag(), "America/Sao_Paulo");
    expect(m.publicar).toHaveBeenCalledWith(expect.objectContaining({
      usuarioId: "profissional", categoria: "EQUIPE", chave: "novo-agendamento:reserva",
      dados: { tipo: "NOVO_AGENDAMENTO", agendamentoId: "reserva", barbeiroId: "b1" },
    }), tx);
  });
  it("não emite avisos para importações antigas, adicionais, cancelados ou concluídos", async () => {
    for (const extra of [{ fim: new Date(0) }, { adicionalDeId: "pai" }, { status: "CANCELADO" }, { status: "CONCLUIDO" }]) await notificarNovoAgendamento(tx, ag(extra), "America/Sao_Paulo");
    expect(m.publicar).not.toHaveBeenCalled();
  });
  it("não envia para profissional inativo ou sem usuário", async () => {
    for (const value of [null, { ativo: false, usuarioId: "u" }, { ativo: true, usuarioId: null }]) {
      m.barbeiro.mockResolvedValueOnce(value);
      await notificarNovoAgendamento(tx, ag(), "America/Sao_Paulo");
    }
    expect(m.publicar).not.toHaveBeenCalled();
  });
});
