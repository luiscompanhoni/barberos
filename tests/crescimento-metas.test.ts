import { describe, expect, it } from "vitest";
import {
  calcularMetasCrescimento, cenariosCapacidade, METAS_CRESCIMENTO_2026,
  projetarReceitaContratoDezembro, type ContratoMeta, type EntradaMetasCrescimento,
} from "@/lib/crescimento/metas";

function contrato(indice = 0, alteracoes: Partial<ContratoMeta> = {}): ContratoMeta {
  return { id: `contrato-${indice}`, clienteId: `cliente-${indice}`, planoId: "plano-real", valorMensalLiquidoCentavos: 10_000,
    inicio: "2026-01-01", fimExclusivo: null, situacao: "ADIMPLENTE", ...alteracoes };
}
function entrada(quantidade = 400): EntradaMetasCrescimento {
  return {
    referencia: "2026-11-08", realizado: {
      inicio: "2026-10-01", fimExclusivo: "2026-11-01", receitaAssinaturasLiquidaCentavos: 4_000_000,
      receitaOutrasVendasLiquidaCentavos: 3_000_000, descontosEstornosJaDeduzidosCentavos: 50_000,
      custosTotaisCentavos: 4_550_000, custosCompletos: true,
    },
    assinantesAdimplentes: quantidade, assinantesAtrasados: 0,
    contratos: Array.from({ length: quantidade }, (_, indice) => contrato(indice)), contratosCompletos: true, cancelamentos: [],
    dezembro: { outrasVendasLiquidasCentavos: 3_000_000, custosBaseCentavos: 4_550_000, custosCompletos: true },
    aquisicao: { contribuicaoVerificada: false, receitaLiquidaPorNovoDezembroCentavos: null, custosVariaveisPorNovoCentavos: null,
      custoIndicacaoTotalPorNovoCentavos: 0, creditoIndicacaoJaDeduzidoReceitaPorNovoCentavos: 0 },
    capacidade: { verificada: true, duracaoVisitaMinutos: 30, minutosOfertaveisDezembro: 100_000,
      minutosOutrasVendasDezembro: 5_000, visitasPlanejadasPorAssinante: 4 },
  };
}
function aquisicaoVerificada(): EntradaMetasCrescimento {
  const caso = entrada(398);
  caso.dezembro = { outrasVendasLiquidasCentavos: 3_002_400, custosBaseCentavos: 3_000_000, custosCompletos: true };
  caso.aquisicao = { contribuicaoVerificada: true, receitaLiquidaPorNovoDezembroCentavos: 8_800,
    custosVariaveisPorNovoCentavos: 3_000, custoIndicacaoTotalPorNovoCentavos: 3_000,
    creditoIndicacaoJaDeduzidoReceitaPorNovoCentavos: 1_000 };
  return caso;
}

describe("metas de crescimento por competência", () => {
  it("separa realizado, MRR e dezembro; preserva receita líquida e meta de 35%", () => {
    const resultado = calcularMetasCrescimento(entrada());
    expect(resultado.metas).toEqual(METAS_CRESCIMENTO_2026);
    expect(resultado.receitaRealizadaLiquidaCentavos).toBe(7_000_000);
    expect(resultado.lucroRealizadoCentavos).toBe(2_450_000);
    expect(resultado.margemLiquidaRealizadaPontosBase).toBe(3_500);
    expect(resultado.mrrNominalReferenciaCentavos).toBe(4_000_000);
    expect(resultado.receitaContratosDezembroCentavos).toBe(4_000_000);
    expect(resultado.receitaDezembroCenarioCentavos).toBe(7_000_000);
    expect(resultado.lucroDezembroCenarioCentavos).toBe(2_450_000);
    expect(resultado.margemLiquidaDezembroPontosBase).toBe(3_500);
    expect(resultado.bloqueios).toEqual([]);
    expect(resultado.orcamentoAprovado).toBe(false);
    expect(resultado.tetoOrcamentoCandidatoCentavos).toBe(0);
  });

  it.each([null, 0, 4_550_000])("não declara lucro/margem com custos incompletos (%s)", (custos) => {
    const caso = aquisicaoVerificada();
    caso.realizado.custosTotaisCentavos = custos;
    caso.realizado.custosCompletos = false;
    caso.dezembro.custosCompletos = false;
    const resultado = calcularMetasCrescimento(caso);
    expect(resultado.lucroRealizadoCentavos).toBeNull();
    expect(resultado.margemLiquidaRealizadaPontosBase).toBeNull();
    expect(resultado.margemLiquidaDezembroPontosBase).toBeNull();
    expect(resultado.tetoOrcamentoCandidatoCentavos).toBeNull();
    expect(resultado.bloqueios).toContain("CUSTOS_REALIZADOS_INCOMPLETOS");
    expect(resultado.bloqueios).toContain("CUSTOS_DEZEMBRO_INCOMPLETOS");
  });

  it("custos marcados completos porém nulos também bloqueiam margem", () => {
    const caso = entrada();
    caso.realizado.custosTotaisCentavos = null;
    caso.dezembro.custosBaseCentavos = null;
    expect(calcularMetasCrescimento(caso).margemLiquidaRealizadaPontosBase).toBeNull();
    expect(calcularMetasCrescimento(caso).tetoOrcamentoCandidatoCentavos).toBeNull();
  });

  it("receita zero não divide por zero; prejuízo continua negativo", () => {
    const caso = entrada();
    caso.realizado.receitaAssinaturasLiquidaCentavos = 0;
    caso.realizado.receitaOutrasVendasLiquidaCentavos = 0;
    expect(calcularMetasCrescimento(caso).margemLiquidaRealizadaPontosBase).toBeNull();
    caso.realizado.receitaAssinaturasLiquidaCentavos = 100_000;
    caso.realizado.custosTotaisCentavos = 200_000;
    expect(calcularMetasCrescimento(caso).margemLiquidaRealizadaPontosBase).toBe(-10_000);
  });

  it("projeta 31 dias, cobertura parcial e cancelamento com fim exclusivo", () => {
    expect(projetarReceitaContratoDezembro(contrato())).toBe(10_000);
    expect(projetarReceitaContratoDezembro(contrato(0, { inicio: "2026-12-16" }))).toBe(5_161);
    expect(projetarReceitaContratoDezembro(contrato(0, { inicio: "2026-12-31" }))).toBe(322);
    expect(projetarReceitaContratoDezembro(contrato(0, { fimExclusivo: "2026-12-16" }))).toBe(4_838);
    expect(projetarReceitaContratoDezembro(contrato(0, { inicio: "2027-01-01" }))).toBe(0);
    expect(projetarReceitaContratoDezembro(contrato(0, { situacao: "ATRASADO" }))).toBe(0);
    const caso = entrada();
    caso.cancelamentos = [{ contratoId: "contrato-0", fimExclusivo: "2026-12-16" }];
    const resultado = calcularMetasCrescimento(caso);
    expect(resultado.assinantesAdimplentesProjetados).toBe(399);
    expect(resultado.novosAdimplentesNecessarios).toBe(1);
    expect(resultado.receitaContratosDezembroCentavos).toBe(3_994_838);
    expect(caso.contratos[0].fimExclusivo).toBeNull();
  });

  it("interpreta instante no fuso de São Paulo e aceita somente strings de data civil", () => {
    const caso = entrada();
    caso.referencia = new Date("2026-11-09T01:00:00Z");
    expect(calcularMetasCrescimento(caso).referenciaCivil).toBe("2026-11-08");
    caso.referencia = "2026-11-09T01:00:00Z";
    expect(() => calcularMetasCrescimento(caso)).toThrow("Data inválida");
    caso.referencia = "2026-11-31";
    expect(() => calcularMetasCrescimento(caso)).toThrow("Data inválida");
  });

  it("não promove atrasados a adimplentes ou receita e mostra bridge de outras vendas", () => {
    const caso = aquisicaoVerificada();
    caso.contratos[0].situacao = "ATRASADO";
    caso.assinantesAdimplentes--;
    caso.assinantesAtrasados++;
    const resultado = calcularMetasCrescimento(caso);
    expect(resultado.assinantesAdimplentesProjetados).toBe(397);
    expect(resultado.novosAdimplentesNecessarios).toBe(3);
    expect(resultado.mrrNominalReferenciaCentavos).toBe(3_980_000);
    expect(resultado.mrrAdimplenteReferenciaCentavos).toBe(3_970_000);
    expect(resultado.bridgeOutrasVendasCentavos).toBe(1_200);
    expect(resultado.bloqueios).toContain("OUTRAS_VENDAS_AINDA_NECESSARIAS");
    expect(resultado.tetoOrcamentoCandidatoCentavos).toBeNull();
  });

  it("conta uma indicação de R$30 uma vez quando R$10 já reduziram receita", () => {
    const resultado = calcularMetasCrescimento(aquisicaoVerificada());
    expect(resultado.receitaNovosDezembroCentavos).toBe(17_600);
    expect(resultado.contribuicaoPorNovoCentavos).toBe(3_800);
    expect(resultado.receitaDezembroCenarioCentavos).toBe(7_000_000);
    expect(resultado.lucroDezembroCenarioCentavos).toBe(3_990_000);
    expect(resultado.tetoOrcamentoCandidatoCentavos).toBe(1_440);
    expect(resultado.cacMaximoCandidatoCentavos).toBe(720);
    expect(resultado.orcamentoAprovado).toBe(false);
  });

  it("bloqueia orçamento sem contribuição verificada ou com custos acima do limite", () => {
    const caso = aquisicaoVerificada();
    caso.aquisicao.contribuicaoVerificada = false;
    expect(calcularMetasCrescimento(caso).tetoOrcamentoCandidatoCentavos).toBeNull();
    caso.aquisicao.contribuicaoVerificada = true;
    caso.dezembro.custosBaseCentavos = 4_550_000;
    expect(calcularMetasCrescimento(caso).bloqueios).toContain("CUSTOS_EXCEDEM_META");
    expect(calcularMetasCrescimento(caso).tetoOrcamentoCandidatoCentavos).toBeNull();
  });

  it("exige cobertura e contagens conciliadas, sem considerar contratos duplicados como pessoas", () => {
    const caso = entrada();
    caso.contratos.push(contrato(400, { clienteId: "cliente-0" }));
    caso.contratosCompletos = false;
    const resultado = calcularMetasCrescimento(caso);
    expect(resultado.assinantesAdimplentesProjetados).toBe(400);
    expect(resultado.bloqueios).toContain("CONTRATOS_INCOMPLETOS");
    expect(resultado.bloqueios).toContain("CONTRATOS_SOBREPOSTOS_POR_CLIENTE");
    expect(resultado.tetoOrcamentoCandidatoCentavos).toBeNull();
  });

  it("permite renovação sucessiva e detecta sobreposição só no meio de dezembro", () => {
    const caso = entrada();
    caso.contratos[0].fimExclusivo = "2026-12-16";
    caso.contratos.push(contrato(400, { clienteId: "cliente-0", inicio: "2026-12-16" }));
    expect(calcularMetasCrescimento(caso).bloqueios).not.toContain("CONTRATOS_SOBREPOSTOS_POR_CLIENTE");
    caso.contratos.push(contrato(401, { clienteId: "cliente-0", inicio: "2026-12-10", fimExclusivo: "2026-12-12" }));
    expect(calcularMetasCrescimento(caso).bloqueios).toContain("CONTRATOS_SOBREPOSTOS_POR_CLIENTE");
  });

  it.each([-1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejeita centavos inválidos: %s", (valor) => {
    const caso = entrada();
    caso.realizado.receitaAssinaturasLiquidaCentavos = valor;
    expect(() => calcularMetasCrescimento(caso)).toThrow(RangeError);
  });

  it("evita overflow intermediário e rejeita total fora da precisão segura", () => {
    expect(projetarReceitaContratoDezembro(contrato(0, { valorMensalLiquidoCentavos: Number.MAX_SAFE_INTEGER }))).toBe(Number.MAX_SAFE_INTEGER);
    const caso = entrada();
    caso.realizado.receitaAssinaturasLiquidaCentavos = Number.MAX_SAFE_INTEGER;
    caso.realizado.receitaOutrasVendasLiquidaCentavos = 1;
    expect(() => calcularMetasCrescimento(caso)).toThrow("precisão");
  });

  it("rejeita crédito superior ao custo total e cancelamento sem contrato", () => {
    const caso = entrada();
    caso.aquisicao.creditoIndicacaoJaDeduzidoReceitaPorNovoCentavos = 1;
    expect(() => calcularMetasCrescimento(caso)).toThrow("excede");
    caso.aquisicao.creditoIndicacaoJaDeduzidoReceitaPorNovoCentavos = 0;
    caso.cancelamentos = [{ contratoId: "ausente", fimExclusivo: "2026-12-01" }];
    expect(() => calcularMetasCrescimento(caso)).toThrow("Cancelamento");
  });
});

describe("capacidade real com folga de 15%", () => {
  it("calcula 2/3/4 visitas com minutos reais, outras vendas e horas", () => {
    const capacidade = { ...entrada().capacidade, minutosOfertaveisDezembro: 60_000, minutosOutrasVendasDezembro: 5_000 };
    const cenarios = cenariosCapacidade(capacidade);
    expect(cenarios.map((cenario) => cenario.minutosNecessarios)).toEqual([29_000, 41_000, 53_000]);
    expect(cenarios.map((cenario) => cenario.viavel)).toEqual([true, true, false]);
    expect(cenarios[0].minutosUtilizaveis).toBe(51_000);
    expect(cenarios[2].horasNecessarias).toBe(53_000 / 60);
    const caso = aquisicaoVerificada();
    caso.capacidade = capacidade;
    expect(calcularMetasCrescimento(caso).bloqueios).toContain("CAPACIDADE_INSUFICIENTE");
  });

  it("não presume duração, agenda verificada ou demanda de outras vendas", () => {
    const caso = aquisicaoVerificada();
    caso.capacidade.duracaoVisitaMinutos = null;
    expect(calcularMetasCrescimento(caso).tetoOrcamentoCandidatoCentavos).toBeNull();
    expect(cenariosCapacidade(caso.capacidade)[0].viavel).toBeNull();
    caso.capacidade = { ...entrada().capacidade, verificada: false };
    expect(cenariosCapacidade(caso.capacidade)[0].viavel).toBeNull();
    caso.capacidade = { ...entrada().capacidade, minutosOutrasVendasDezembro: null };
    expect(calcularMetasCrescimento(caso).bloqueios).toContain("CAPACIDADE_NAO_VERIFICADA");
  });

  it("não limita demanda a 400 quando a projeção já supera a meta", () => {
    const resultado = calcularMetasCrescimento(entrada(401));
    expect(resultado.cenariosCapacidade[2].assinantesConsiderados).toBe(401);
    expect(resultado.cenariosCapacidade[2].minutosNecessarios).toBe(53_120);
  });

  it("rejeita minutos negativos, duração zero e overflow", () => {
    expect(() => cenariosCapacidade({ ...entrada().capacidade, minutosOfertaveisDezembro: -1 })).toThrow(RangeError);
    expect(() => cenariosCapacidade({ ...entrada().capacidade, duracaoVisitaMinutos: 0 })).toThrow(RangeError);
    expect(() => cenariosCapacidade({ ...entrada().capacidade, duracaoVisitaMinutos: Number.MAX_SAFE_INTEGER })).toThrow("precisão");
  });
});
