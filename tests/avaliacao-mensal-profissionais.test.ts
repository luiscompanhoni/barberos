import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ cobranca: vi.fn(), agendamentos: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { cobranca: { findFirst: m.cobranca }, agendamento: { findMany: m.agendamentos } } }));

import { listarProfissionaisAvaliaveis, periodoAnteriorAoPagamento } from "@/lib/avaliacoes/mensal-profissionais";

beforeEach(() => {
  vi.resetAllMocks();
  m.cobranca.mockResolvedValue({ status: "PAGA", pagaEm: new Date("2026-11-01T03:00:00Z") });
  m.agendamentos.mockResolvedValue([{ barbeiroId: "b1", barbeiro: { id: "b1", nome: "Profissional" } }]);
});

describe("período e profissionais elegíveis da avaliação", () => {
  it("usa o mês anterior ao pagamento no fuso da Black, inclusive virada de ano", () => {
    const r = periodoAnteriorAoPagamento(new Date("2026-01-01T03:00:00Z"));
    expect(r).toEqual({ competencia: "2025-12", inicio: new Date("2025-12-01T03:00:00Z"), fimExclusivo: new Date("2026-01-01T03:00:00Z") });
    expect(periodoAnteriorAoPagamento(new Date("2026-11-01T02:59:59Z")).competencia).toBe("2026-09");
    expect(() => periodoAnteriorAoPagamento(new Date("inválida"))).toThrow();
  });

  it("filtra cliente, status concluído e intervalo local anterior ao pagamento, sem gravar voto", async () => {
    const r = await listarProfissionaisAvaliaveis("c1", "f1", new Date("2026-11-03T12:00:00Z"));
    expect(m.cobranca).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "f1", assinatura: { clienteId: "c1", cliente: { excluidoEm: null } } } }));
    expect(m.agendamentos).toHaveBeenCalledWith(expect.objectContaining({
      where: { clienteId: "c1", status: "CONCLUIDO", inicio: { gte: new Date("2026-10-01T03:00:00Z"), lt: new Date("2026-11-01T03:00:00Z") } },
      distinct: ["barbeiroId"],
    }));
    expect(r).toEqual({ competencia: "2026-10", profissionais: [{ id: "b1", nome: "Profissional" }] });
  });

  it.each([
    ["cobrança de outra pessoa", null],
    ["cobrança pendente", { status: "PENDENTE", pagaEm: null }],
    ["pagamento sem data", { status: "PAGA", pagaEm: null }],
    ["pagamento futuro", { status: "PAGA", pagaEm: new Date("2027-01-01T00:00:00Z") }],
    ["pagamento estornado", { status: "ESTORNADA", pagaEm: new Date("2026-11-01T03:00:00Z") }],
  ])("não consulta atendimentos para %s", async (_cenario, cobranca) => {
    m.cobranca.mockResolvedValueOnce(cobranca);
    await expect(listarProfissionaisAvaliaveis("c1", "f1", new Date("2026-11-03T12:00:00Z"))).rejects.toThrow();
    expect(m.agendamentos).not.toHaveBeenCalled();
  });
});
