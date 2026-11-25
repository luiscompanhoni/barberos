import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Agendamento, Prisma } from "@prisma/client";
const m = vi.hoisted(() => ({ publicar: vi.fn(), barbeiro: vi.fn(), detalhes: vi.fn(), gestores: vi.fn() }));
vi.mock("@/lib/notificacoes/caixa", () => ({ publicarNotificacao: m.publicar }));
import { notificarNovoAgendamento } from "@/lib/notificacoes/novo-agendamento";
const tx = { barbeiro: { findUnique: m.barbeiro }, agendamento: { findUniqueOrThrow: m.detalhes }, usuario: { findMany: m.gestores } } as unknown as Prisma.TransactionClient;
const ag = (extra = {}) => ({ id: "reserva", barbeiroId: "b1", adicionalDeId: null, status: "MARCADO", inicio: new Date(Date.now() + 1_800_000), fim: new Date(Date.now() + 3_600_000), ...extra } as Agendamento);
beforeEach(() => {
  vi.clearAllMocks(); m.barbeiro.mockResolvedValue({ ativo: true, usuarioId: "profissional" });
  m.detalhes.mockResolvedValue({ cliente: { nome: "Cliente Teste" }, servico: { nome: "Corte" }, adicionais: [], barbeiro: { ativo: true, usuarioId: "profissional", nome: "Ygor" } });
  m.gestores.mockResolvedValue([]);
});
describe("avisos privados de novas reservas", () => {
  it("grava um aviso com chave estável para o usuário do barbeiro na transação da reserva", async () => {
    await notificarNovoAgendamento(tx, ag(), "America/Sao_Paulo");
    expect(m.publicar).toHaveBeenCalledWith(expect.objectContaining({
      usuarioId: "profissional", categoria: "EQUIPE", chave: "novo-agendamento:reserva",
      corpo: expect.stringMatching(/Cliente Teste.*Corte.*Ygor/),
      dados: expect.objectContaining({ tipo: "NOVO_AGENDAMENTO", agendamentoId: "reserva", barbeiroId: "b1", inicio: expect.any(String) }),
    }), tx);
  });
  it("não emite avisos para importações antigas, adicionais, cancelados ou concluídos", async () => {
    for (const extra of [{ fim: new Date(0) }, { adicionalDeId: "pai" }, { status: "CANCELADO" }, { status: "CONCLUIDO" }]) await notificarNovoAgendamento(tx, ag(extra), "America/Sao_Paulo");
    expect(m.publicar).not.toHaveBeenCalled();
  });
  it("não envia para profissional inativo ou sem usuário", async () => {
    for (const value of [null, { ativo: false, usuarioId: "u" }, { ativo: true, usuarioId: null }]) {
      m.barbeiro.mockResolvedValueOnce(value);
      m.detalhes.mockResolvedValueOnce({ barbeiro: value });
      await notificarNovoAgendamento(tx, ag(), "America/Sao_Paulo");
    }
    expect(m.publicar).not.toHaveBeenCalled();
  });
  it("avisa dono e gerente sem agenda própria e não duplica dono que é o profissional", async () => {
    m.gestores.mockResolvedValue([{ id: "profissional" }, { id: "gerente" }, { id: "dono" }]);
    await notificarNovoAgendamento(tx, ag(), "America/Sao_Paulo");
    expect(m.publicar.mock.calls.map(c => c[0].usuarioId).sort()).toEqual(["dono", "gerente", "profissional"]);
    expect(m.gestores).toHaveBeenCalledWith(expect.objectContaining({ where: { ativo: true, papel: { in: ["DONO", "GERENTE"] } } }));
    expect(m.publicar).toHaveBeenCalledWith(expect.objectContaining({ usuarioId: "gerente", href: expect.stringMatching(/^\/recepcao\?/) }), tx);
  });
});
