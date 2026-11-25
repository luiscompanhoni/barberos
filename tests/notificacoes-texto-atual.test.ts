import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ atendimento: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { agendamento: { findFirst: m.atendimento } } }));
import { corpoAtualPush } from "@/lib/notificacoes/texto-atual";
const n = { usuarioId: "cliente", categoria: "AGENDA", corpo: "Texto antigo", dados: { agendamentoId: "reserva", inicio: "2026-11-26T12:30:00.000Z", tipo: "LEMBRETE_PROXIMO" } };
beforeEach(() => vi.clearAllMocks());
it("recarrega o serviço e o profissional atuais antes de enviar", async () => {
  m.atendimento.mockResolvedValue({ inicio: new Date(n.dados.inicio), cliente: { nome: "Cliente" }, barbeiro: { nome: "Novo barbeiro" }, servico: { nome: "Corte atualizado" }, adicionais: [{ servico: { nome: "Barba" } }] });
  expect(await corpoAtualPush(n, "America/Sao_Paulo")).toBe("Corte atualizado + Barba com Novo barbeiro · 26/11/2026 às 09:30");
  expect(m.atendimento.mock.calls[0][0].where).toMatchObject({ id: "reserva", inicio: new Date(n.dados.inicio), adicionalDeId: null });
});
it("não envia texto antigo quando a reserva mudou ou foi cancelada", async () => {
  m.atendimento.mockResolvedValue(null);
  expect(await corpoAtualPush(n, "America/Sao_Paulo")).toBeNull();
});
it("não inclui nome do próprio cliente no lembrete e preserva outros assuntos", async () => {
  expect(await corpoAtualPush({ ...n, categoria: "AVALIACAO" }, "America/Sao_Paulo")).toBe("Texto antigo");
  expect(m.atendimento).not.toHaveBeenCalled();
});
