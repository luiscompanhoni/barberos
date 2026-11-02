import { describe, expect, it } from "vitest";
import { avaliarDesempenho, type MetricasDesempenho, type PoliticaDesempenho } from "@/lib/agentes/desempenho";

const agora = new Date("2026-10-12T15:00:00Z");
const metricas: MetricasDesempenho = { inicioEm: "2026-10-01T03:00:00Z", fimEm: "2026-10-08T03:00:00Z", consultadoEm: "2026-10-12T14:00:00Z",
  gastoCentavos: 10000, impressoes: 2000, cliques: 100, leads: 10, conversoes: 5, receitaCentavos: 59000,
  fonteReceita: "barberos_conciliado", atribuicaoCoerente: true, escopoOrcamentoCompleto: true };
const politica: PoliticaDesempenho = { diasMinimos: 3, impressoesMinimas: 1000, cliquesMinimos: 30, atrasoAtribuicaoHoras: 72,
  maxIdadeColetaHoras: 24, cplMaxCentavos: 1500, cpaMaxCentavos: 2500, roasMin: 2, limiteGastoCentavos: 20000 };

describe("desempenho: custos e atribuição", () => {
  it("calcula métricas sem substituir caixa por atribuição publicitária", () => {
    const r = avaliarDesempenho(metricas, politica, agora);
    expect(r.situacao).toBe("DENTRO_DA_META");
    expect(r.metricas).toEqual({ ctrPct: 5, cplCentavos: 1000, cpaCentavos: 2000, roas: 5.9, fonteReceita: "barberos_conciliado" });
    expect(r.executaMudancas).toBe(false);
    expect(avaliarDesempenho({ ...metricas, fonteReceita: "meta_atribuida" }, politica, agora).alertas.join(" ")).toContain("não é receita conciliada");
  });
  it("zero denominadores ficam nulos e não produzem infinito nem sucesso falso", () => {
    const r = avaliarDesempenho({ ...metricas, gastoCentavos: 0, impressoes: 0, cliques: 0, leads: 0, conversoes: 0 }, politica, agora);
    expect(r.situacao).toBe("INCONCLUSIVO");
    expect(r.metricas).toMatchObject({ ctrPct: null, cplCentavos: null, cpaCentavos: null, roas: null });
  });
  it("nenhuma conversão após amostra madura pede revisão, sem inventar CPA", () => {
    const r = avaliarDesempenho({ ...metricas, leads: 0, conversoes: 0, receitaCentavos: 0 }, politica, agora);
    expect(r.situacao).toBe("REVISAR");
    expect(r.metricas.cpaCentavos).toBeNull();
    expect(r.encaminhamentos.map(x => x.agenteId)).toEqual(["estrategia", "conteudo", "trafego"]);
    expect(r.encaminhamentos.every(x => x.exigeAprovacao)).toBe(true);
  });
  it.each([
    { cliques: 5 }, { inicioEm: "2026-10-07T03:00:00Z" }, { fimEm: "2026-10-12T03:00:00Z" },
    { consultadoEm: "2026-10-10T14:00:00Z" }, { atribuicaoCoerente: false }, { leads: null },
  ])("não otimiza com observação insuficiente (%j)", patch => {
    const r = avaliarDesempenho({ ...metricas, ...patch }, politica, agora);
    expect(r.situacao).toBe("INCONCLUSIVO");
    expect(r.encaminhamentos).toHaveLength(1);
    expect(r.encaminhamentos[0].agenteId).toBe("estrategia");
  });
  it("ausência de receita é diferente de receita zero", () => {
    const r = avaliarDesempenho({ ...metricas, receitaCentavos: null, fonteReceita: "ausente" }, politica, agora);
    expect(r.situacao).toBe("INCONCLUSIVO");
    expect(r.metricas.roas).toBeNull();
    expect(() => avaliarDesempenho({ ...metricas, receitaCentavos: null }, politica, agora)).toThrow();
  });
  it("não classifica sem meta de resultado", () => {
    expect(avaliarDesempenho(metricas, { ...politica, cplMaxCentavos: null, cpaMaxCentavos: null, roasMin: null }, agora).situacao).toBe("INCONCLUSIVO");
  });
});

describe("desempenho: orçamento e limites", () => {
  it("não infere saldo restante de gasto incompleto ou atrasado", () => {
    const r = avaliarDesempenho({ ...metricas, escopoOrcamentoCompleto: false }, politica, agora);
    expect(r.alertas.join(" ")).toContain("Não foi inferido saldo restante");
    expect(r.encaminhamentos).toHaveLength(0);
  });
  it("teto observado pede conferência mesmo com atribuição ainda incompleta", () => {
    const r = avaliarDesempenho({ ...metricas, gastoCentavos: 20000, cliques: 5 }, politica, agora);
    expect(r.situacao).toBe("REVISAR");
    expect(r.encaminhamentos[0]).toMatchObject({ agenteId: "trafego", exigeAprovacao: true });
    expect(r.encaminhamentos[0].tarefa).toContain("não aumentar orçamento");
    expect(r.executaMudancas).toBe(false);
  });
  it("rejeita dados inválidos em vez de fabricar indicadores", () => {
    expect(() => avaliarDesempenho({ ...metricas, gastoCentavos: -1 }, politica, agora)).toThrow();
    expect(() => avaliarDesempenho({ ...metricas, consultadoEm: "2026-10-13T14:00:00Z" }, politica, agora)).toThrow();
    expect(() => avaliarDesempenho({ ...metricas, fimEm: "2026-10-01T02:00:00Z" }, politica, agora)).toThrow();
  });
});
