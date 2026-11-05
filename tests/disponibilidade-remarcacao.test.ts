import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ dia: vi.fn(), cadeira: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { barbeiro: { findMany: async () => [{ id: "b", nome: "Profissional", cadeiraId: "cadeira" }] } } }));
vi.mock("@/lib/agenda/carregar", () => ({
  configuracao: async () => ({ fuso: "America/Sao_Paulo", granularidadeMin: 15, antecedenciaMinimaMin: 0, intervaloEntreClientes: 0 }),
  servicoDoBarbeiro: async () => ({ duracaoMin: 30, minimoDuracaoMin: 5, precoCentavos: 5000 }),
  carregarDia: m.dia, limitesDoDia: () => ({ inicio: Date.parse("2026-11-05T03:00Z"), fim: Date.parse("2026-11-06T03:00Z") }),
}));
vi.mock("@/lib/agenda/cadeiras", () => ({ ocupacaoCadeira: m.cadeira }));
import { horariosDisponiveis } from "@/lib/agenda/consultas";
const inicio = Date.parse("2026-11-05T13:00Z"), fim = inicio + 30 * 60_000;
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-04T12:00Z"));
  m.dia.mockImplementation(async (_d, _ids, opts) => new Map([["b", { janelas: [{ inicio, fim: fim + 60 * 60_000 }], bloqueios: [], agendamentos: opts.ignorarAgendamentoId === "ag" ? [] : [{ id: "ag", inicio, fim }] }]]));
  m.cadeira.mockImplementation(async (_id, _int, _db, ignorar) => ignorar === "ag" ? [] : [{ inicio: new Date(inicio), fim: new Date(fim) }]);
});
afterEach(() => vi.useRealTimers());
describe("recalcular a vaga do próprio agendamento", () => {
  it("remove a ocupação do próprio atendimento no profissional e cadeira ao remarcar", async () => {
    const base = { data: "2026-11-05", servicoId: "corte", paraCliente: true };
    const [novo] = await horariosDisponiveis(base);
    expect(novo.horarios).not.toContain("2026-11-05T13:00:00.000Z");
    const [remarcado] = await horariosDisponiveis({ ...base, ignorarAgendamentoId: "ag" });
    expect(remarcado.horarios).toContain("2026-11-05T13:00:00.000Z");
    expect(m.dia).toHaveBeenLastCalledWith(base.data, ["b"], expect.objectContaining({ ignorarAgendamentoId: "ag" }));
    expect(m.cadeira.mock.lastCall?.[3]).toBe("ag");
  });
});
