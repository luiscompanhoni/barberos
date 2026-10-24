import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { horariosDisponiveis } from "@/lib/agenda/consultas";

const m = vi.hoisted(() => ({ dia: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { barbeiro: { findMany: async () => [{ id: "fauli", nome: "Faúli" }] } } }));
vi.mock("@/lib/agenda/carregar", () => ({
  configuracao: async () => ({ fuso: "America/Sao_Paulo", granularidadeMin: 15, antecedenciaMinimaMin: 30, intervaloEntreClientes: 0 }),
  servicoDoBarbeiro: async () => ({ duracaoMin: 30, precoCentavos: 6500 }),
  carregarDia: m.dia,
}));

describe("seleção de horários da recepção", () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-21T16:00:00Z")); // 13h local
    m.dia.mockResolvedValue(new Map([["fauli", {
      janelas: [{ inicio: Date.parse("2026-10-21T12:00:00Z"), fim: Date.parse("2026-10-21T21:00:00Z") }],
      bloqueios: [], agendamentos: [{ inicio: Date.parse("2026-10-21T13:00:00Z"), fim: Date.parse("2026-10-21T13:30:00Z") }],
    }]]));
  });
  afterEach(() => vi.useRealTimers());
  it("às 13h permite registrar o corte das 9h e mantém conflitos", async () => {
    const [r] = await horariosDisponiveis({ data: "2026-10-21", servicoId: "corte", paraCliente: false });
    expect(r.horarios).toContain("2026-10-21T12:00:00.000Z");
    expect(r.horarios).not.toContain("2026-10-21T13:00:00.000Z");
    expect(r.horarios).not.toContain("2026-10-21T11:00:00.000Z");
  });
  it("cliente continua sem horários passados e respeita antecedência", async () => {
    const [r] = await horariosDisponiveis({ data: "2026-10-21", servicoId: "corte", paraCliente: true });
    expect(r.horarios.length).toBeGreaterThan(0);
    expect(r.horarios.every((h) => Date.parse(h) >= Date.parse("2026-10-21T16:30:00Z"))).toBe(true);
  });
});
