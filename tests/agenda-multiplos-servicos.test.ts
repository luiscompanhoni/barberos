import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { horariosDisponiveis } from "@/lib/agenda/consultas";

const m = vi.hoisted(() => ({ servico: vi.fn(), dia: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { barbeiro: { findMany: async () => [{ id: "b1", nome: "Profissional", cadeiraId: null }] } } }));
vi.mock("@/lib/agenda/carregar", () => ({
  configuracao: async () => ({ fuso: "America/Sao_Paulo", granularidadeMin: 15, antecedenciaMinimaMin: 0, intervaloEntreClientes: 0 }),
  servicoDoBarbeiro: m.servico,
  carregarDia: m.dia,
}));

describe("disponibilidade para vários serviços", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T12:00:00Z"));
    m.dia.mockResolvedValue(new Map([["b1", { janelas: [{ inicio: Date.parse("2026-10-21T13:00:00Z"), fim: Date.parse("2026-10-21T15:00:00Z") }], bloqueios: [], agendamentos: [{ inicio: Date.parse("2026-10-21T14:00:00Z"), fim: Date.parse("2026-10-21T14:30:00Z") }] }]]));
    m.servico.mockImplementation(async (_b, id) => id === "corte" ? { duracaoMin: 30, minimoDuracaoMin: 10, precoCentavos: 5000 } : id === "barba" ? { duracaoMin: 30, minimoDuracaoMin: 10, precoCentavos: 3000 } : null);
  });
  afterEach(() => vi.useRealTimers());
  it("soma duração e valor e não oferece intervalo que caiba apenas no primeiro serviço", async () => {
    const [r] = await horariosDisponiveis({ data: "2026-10-21", servicoId: "corte", servicosAdicionais: ["barba"], paraCliente: true });
    expect(r.duracaoMin).toBe(60);
    expect(r.precoCentavos).toBe(8000);
    expect(r.horarios).toContain("2026-10-21T13:00:00.000Z");
    expect(r.horarios).not.toContain("2026-10-21T13:15:00.000Z");
  });
  it("não oferece profissional que não faz todos os serviços", async () => {
    const r = await horariosDisponiveis({ data: "2026-10-21", servicoId: "corte", servicosAdicionais: ["servico-incompativel"], paraCliente: true });
    expect(r).toEqual([]);
  });
});
