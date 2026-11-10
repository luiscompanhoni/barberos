import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { horariosDisponiveis } from "@/lib/agenda/consultas";
import { comprovarConsultaEsperaSite } from "@/lib/agenda/consulta-espera";

const m = vi.hoisted(() => ({ espera: vi.fn(), servico: vi.fn(), dia: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { esperaHorario: { findFirst: m.espera }, barbeiro: { findMany: async () => [{ id: "b", nome: "Nome", cadeiraId: null }] } } }));
vi.mock("@/lib/agenda/carregar", () => ({
  configuracao: async () => ({ fuso: "America/Sao_Paulo", agendaExternaAtiva: true, granularidadeMin: 15, antecedenciaMinimaMin: 0, intervaloEntreClientes: 0 }),
  servicoDoBarbeiro: m.servico, carregarDia: m.dia,
}));
const consulta = { data: "2026-11-11", servicoId: "corte", servicosAdicionais: ["barba"], barbeiroId: "b", paraCliente: true };

describe("consulta interna de vaga para espera do app", () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-10T14:00:00Z"));
    m.espera.mockResolvedValue({ data: new Date("2026-11-11T00:00:00Z"), servicoId: "corte", servicosAdicionais: ["barba"], barbeiroId: "b" });
    m.servico.mockImplementation(async (_b, id) => id === "incompativel" ? null : { duracaoMin: 30, minimoDuracaoMin: 5, precoCentavos: 1000 });
    m.dia.mockResolvedValue(new Map([["b", { janelas: [{ inicio: Date.parse("2026-11-11T13:00:00Z"), fim: Date.parse("2026-11-11T14:00:00Z") }], bloqueios: [], agendamentos: [] }]]));
  });
  afterEach(() => vi.useRealTimers());

  it("fonte externa continua bloqueando consulta automática sem sessão ou espera comprovada", async () => {
    await expect(horariosDisponiveis(consulta)).rejects.toMatchObject({ codigo: "confirmacao_equipe" });
    expect(m.espera).not.toHaveBeenCalled();
  });
  it("exige espera SITE ativa, data, barbeiro e conjunto exatamente correspondentes", async () => {
    await comprovarConsultaEsperaSite("pedido", consulta);
    expect(m.espera).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "pedido", origem: "SITE", status: "ATIVA", cliente: { excluidoEm: null } } }));
    await expect(comprovarConsultaEsperaSite("pedido", { ...consulta, barbeiroId: "outro" })).rejects.toMatchObject({ status: 404 });
    await expect(comprovarConsultaEsperaSite("pedido", { ...consulta, data: "2026-11-12" })).rejects.toMatchObject({ status: 404 });
    await expect(comprovarConsultaEsperaSite("pedido", { ...consulta, servicosAdicionais: [] })).rejects.toMatchObject({ status: 404 });
    m.espera.mockResolvedValue(null);
    await expect(comprovarConsultaEsperaSite("cancelada-ou-bot", consulta)).rejects.toMatchObject({ status: 404 });
  });
  it("lê vaga para duração conjunta sem abrir reserva nem oferecer profissional incompatível", async () => {
    const [disponivel] = await horariosDisponiveis({ ...consulta, esperaId: "pedido" });
    expect(disponivel.duracaoMin).toBe(60);
    expect(disponivel.horarios).toEqual(["2026-11-11T13:00:00.000Z"]);
    m.espera.mockResolvedValue({ data: new Date("2026-11-11T00:00:00Z"), servicoId: "corte", servicosAdicionais: ["incompativel"], barbeiroId: "b" });
    expect(await horariosDisponiveis({ ...consulta, servicosAdicionais: ["incompativel"], esperaId: "pedido" })).toEqual([]);
  });
});
