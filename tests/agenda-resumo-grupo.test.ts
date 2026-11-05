import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ agendamentos: vi.fn(), barbeiros: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { agendamento: { findMany: m.agendamentos }, barbeiro: { findMany: m.barbeiros } } }));
vi.mock("@/lib/agenda/carregar", () => ({ configuracao: async () => ({ fuso: "America/Sao_Paulo", granularidadeMin: 15, intervaloEntreClientes: 0 }),
  limitesDoDia: () => ({ inicio: 0, fim: 86400000 }), carregarDia: async () => new Map(), servicoDoBarbeiro: vi.fn() }));
import { agendaDoPeriodo } from "@/lib/agenda/consultas";
const item = { id: "ag", inicio: new Date("2026-11-06T13:00Z"), fim: new Date("2026-11-06T14:00Z"), precoCentavos: 5000, assinaturaId: null,
  adicionais: [{ precoCentavos: 3000, assinaturaId: null, servico: { nome: "Barba" } }], premiosGanhos: [] };
beforeEach(() => { vi.resetAllMocks(); m.barbeiros.mockResolvedValue([]); m.agendamentos.mockResolvedValue([item]); });
describe("agenda apresenta preço e cobertura do grupo inteiro", () => {
  it("mantém preço do principal para operações existentes e inclui o total agregado", async () => {
    const r = await agendaDoPeriodo("2026-11-06", 1);
    expect(r.agendamentos[0]).toMatchObject({ precoCentavos: 5000, totalServicosCentavos: 8000, coberturaPlano: "NENHUMA", adicionais: ["Barba"] });
  });
  it("principal incluído com adicional pago é cobertura parcial", async () => {
    m.agendamentos.mockResolvedValue([{ ...item, precoCentavos: 0, assinaturaId: "a" }]);
    expect((await agendaDoPeriodo("2026-11-06", 1)).agendamentos[0]).toMatchObject({ totalServicosCentavos: 3000, coberturaPlano: "PARCIAL" });
  });
  it("só indica cobertura total quando todos os serviços têm assinatura", async () => {
    m.agendamentos.mockResolvedValue([{ ...item, precoCentavos: 0, assinaturaId: "a", adicionais: [{ ...item.adicionais[0], precoCentavos: 0, assinaturaId: "a" }] }]);
    expect((await agendaDoPeriodo("2026-11-06", 1)).agendamentos[0]).toMatchObject({ totalServicosCentavos: 0, coberturaPlano: "TOTAL" });
  });
});
