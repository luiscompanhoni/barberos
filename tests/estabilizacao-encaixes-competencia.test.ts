import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ profissionais: vi.fn(), permissao: vi.fn(), regras: vi.fn(), adicionais: vi.fn(), dia: vi.fn(), rascunho: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { barbeiro: { findMany: m.profissionais }, comissaoServico: { findMany: m.rascunho } } }));
vi.mock("@/lib/auth/permissoes", () => ({ pode: m.permissao }));
vi.mock("@/lib/rh/config-calculo", () => ({ regrasServicosNaCompetencia: m.regras }));
vi.mock("@/lib/rh/adicionais", () => ({ adicionaisDoCalculo: m.adicionais }));
vi.mock("@/lib/agenda/carregar", () => ({ configuracao: async () => ({ fuso: "America/Sao_Paulo", granularidadeMin: 15, intervaloEntreClientes: 0 }), carregarDia: m.dia, limitesDoDia: () => ({ inicio: 0, fim: 0 }) }));
vi.mock("@/lib/agenda/cadeiras", () => ({ ocupacaoCadeira: async () => [] }));
import { encaixesDoDia } from "@/lib/agenda/encaixes";
import type { Sessao } from "@/lib/auth/sessao";
const dono = { usuarioId: "d", papel: "DONO", barbeiroId: null } as Sessao;
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-01T12:00Z"));
  m.profissionais.mockResolvedValue([{ id: "b", nome: "Profissional fictício", cadeiraId: null, servicos: [{ servicoId: "s", duracaoMin: null, precoCentavos: null, servico: { id: "s", nome: "Serviço", duracaoMin: 30, precoCentavos: 10000 } }] }]);
  m.permissao.mockResolvedValue(true); m.adicionais.mockResolvedValue([]);
  m.regras.mockImplementation(async competencia => [{ servicoId: "s", barbeiroId: null, avulsoTipo: "PERCENTUAL", avulsoValor: competencia === "2026-11" ? 1000 : 4000, planoTipo: "FIXO", planoValor: 0 }]);
  m.dia.mockImplementation(async data => { const inicio = Date.parse(`${data}T12:00:00Z`); return new Map([["b", { janelas: [{ inicio, fim: inicio + 3600000 }], bloqueios: [], agendamentos: [] }]]); });
  m.rascunho.mockImplementation(() => { throw Error("Rascunho futuro não pode substituir a competência solicitada"); });
});
afterEach(() => vi.useRealTimers());
describe("encaixes respeitam vigência da remuneração", () => {
  it("usa a competência do atendimento, preservando novembro ao cadastrar regra para dezembro", async () => {
    const atual = await encaixesDoDia({ data: "2026-11-02" }, dono);
    const futuro = await encaixesDoDia({ data: "2026-12-02" }, dono);
    expect(atual.profissionais[0].servicos[0].comissaoCentavos).toBe(1000);
    expect(futuro.profissionais[0].servicos[0].comissaoCentavos).toBe(4000);
    expect(m.regras.mock.calls.map(c => c[0])).toEqual(["2026-11", "2026-12"]);
    expect(m.rascunho).not.toHaveBeenCalled();
  });
  it("não lê remuneração quando não pode mostrar nenhuma comissão", async () => {
    m.permissao.mockResolvedValue(false);
    const r = await encaixesDoDia({ data: "2026-11-02" }, { ...dono, papel: "RECEPCAO" });
    expect(r.profissionais[0].servicos[0].comissaoCentavos).toBeNull();
    expect(m.regras).not.toHaveBeenCalled(); expect(m.adicionais).not.toHaveBeenCalled();
  });
  it("barbeiro continua vendo a própria comissão com a vigência da data escolhida", async () => {
    m.permissao.mockResolvedValue(false);
    const r = await encaixesDoDia({ data: "2026-12-02" }, { ...dono, papel: "BARBEIRO", barbeiroId: "b" });
    expect(r.profissionais[0].servicos[0].comissaoCentavos).toBe(4000);
    expect(m.regras).toHaveBeenCalledWith("2026-12");
  });
});
