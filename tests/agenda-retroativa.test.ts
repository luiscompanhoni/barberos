import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { horariosDisponiveis } from "@/lib/agenda/consultas";
import { recusaRetroativo } from "@/lib/agenda/tempo";

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
  it("lançar atendimento passado: hoje para a equipe, outros dias só dono e gerente", () => {
    const agora = Date.parse("2026-10-21T16:00:00Z"); // 13h local
    const hoje9h = Date.parse("2026-10-21T12:00:00Z");
    const ontem = Date.parse("2026-10-20T12:00:00Z");
    const fim = (i: number) => i + 30 * 60_000;
    expect(recusaRetroativo("BARBEIRO", hoje9h, fim(hoje9h), agora)).toBeNull();
    expect(recusaRetroativo("RECEPCAO", ontem, fim(ontem), agora)).toMatch(/dono ou gerente/);
    expect(recusaRetroativo("BARBEIRO", ontem, fim(ontem), agora)).toMatch(/dono ou gerente/);
    expect(recusaRetroativo("GERENTE", ontem, fim(ontem), agora)).toBeNull();
    expect(recusaRetroativo("DONO", agora - 10 * 60_000, agora + 20 * 60_000, agora)).toMatch(/não terminou/);
    expect(recusaRetroativo("CLIENTE", hoje9h, fim(hoje9h), agora)).toMatch(/equipe/);
  });
  it("cliente continua sem horários passados e respeita antecedência", async () => {
    const [r] = await horariosDisponiveis({ data: "2026-10-21", servicoId: "corte", paraCliente: true });
    expect(r.horarios.length).toBeGreaterThan(0);
    expect(r.horarios.every((h) => Date.parse(h) >= Date.parse("2026-10-21T16:30:00Z"))).toBe(true);
  });
});
