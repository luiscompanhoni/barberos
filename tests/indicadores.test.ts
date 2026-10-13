import { describe, expect, it } from "vitest";
import { fazAniversario } from "@/lib/automacoes/regras";
import { churnMensal, faixaEtaria, faixaFrequencia, idade, intervalosPorCliente, ltv, mediana, situacaoPelaUltimaVisita, taxaDeRetorno } from "@/lib/indicadores/calculos";
import { gerarLeituras } from "@/lib/indicadores/leituras";
import { resolverPeriodo } from "@/lib/indicadores/periodo";

const D = 86_400_000;
const FUSO = "America/Sao_Paulo";

describe("contas", () => {
  it("idade e faixa", () => {
    expect(idade("1990-10-01", "2026-09-30")).toBe(35);
    expect(idade("1990-09-30", "2026-09-30")).toBe(36);
    expect(faixaEtaria(17)).toBe("até 17");
    expect(faixaEtaria(34)).toBe("25–34");
    expect(faixaEtaria(60)).toBe("55+");
  });
  it("intervalo medio entre visitas e faixa de frequencia", () => {
    const m = intervalosPorCliente(new Map([["a", [0, 14 * D, 28 * D]], ["b", [5 * D]], ["c", [30 * D, 0]]]));
    expect(m.get("a")).toBe(14);
    expect(m.has("b")).toBe(false); // uma visita so
    expect(m.get("c")).toBe(30);
    expect(faixaFrequencia(7)).toMatch(/Semanal/);
    expect(faixaFrequencia(14)).toMatch(/Quinzenal/);
    expect(faixaFrequencia(30)).toMatch(/Mensal/);
    expect(mediana([3, 1, 2, 10])).toBe(2.5);
  });
  it("retorno de clientes novos em ate 45 dias", () => {
    expect(taxaDeRetorno([[0, 20 * D], [0, 60 * D], [0, null], [0, 45 * D]])).toEqual({ base: 4, voltaram: 2, taxa: 0.5 });
    expect(taxaDeRetorno([]).taxa).toBeNull();
  });
  it("churn levado para 30 dias e LTV", () => {
    expect(churnMensal(2, 40, 30)).toBeCloseTo(0.05);
    expect(churnMensal(1, 40, 7)).toBeCloseTo((1 / 40) * (30 / 7));
    expect(churnMensal(1, 0, 30)).toBeNull();
    expect(ltv(9900, 0.05)).toBe(198000);
    expect(ltv(9900, null)).toBeNull();
  });
  it("situacao pela ultima visita", () => {
    expect(situacaoPelaUltimaVisita(0, 30 * D)).toBe("ativo");
    expect(situacaoPelaUltimaVisita(0, 60 * D)).toBe("risco");
    expect(situacaoPelaUltimaVisita(0, 120 * D)).toBe("perdido");
  });
  it("aniversario (29/02 comemora em 28/02 fora do bissexto)", () => {
    expect(fazAniversario("1990-09-30", "2026-09-30")).toBe(true);
    expect(fazAniversario("1990-09-29", "2026-09-30")).toBe(false);
    expect(fazAniversario("2000-02-29", "2027-02-28")).toBe(true);
    expect(fazAniversario("2000-02-29", "2028-02-28")).toBe(false);
    expect(fazAniversario("2000-02-29", "2028-02-29")).toBe(true);
  });
});

describe("periodos", () => {
  const agora = Date.UTC(2026, 8, 30, 15, 0); // 30/09/2026 12:00 em Brasilia
  it("30 dias terminando hoje, com periodo anterior do mesmo tamanho", () => {
    const p = resolverPeriodo("30d", FUSO, agora);
    expect(p.dias[0]).toBe("2026-09-01");
    expect(p.dias.at(-1)).toBe("2026-09-30");
    expect(p.anterior.ate).toBe(p.de);
    expect(p.anterior.ate - p.anterior.de).toBe(p.ate - p.de);
  });
  it("mes passado inteiro", () => {
    const p = resolverPeriodo("mes_passado", FUSO, agora);
    expect(p.dias[0]).toBe("2026-08-01");
    expect(p.dias.at(-1)).toBe("2026-08-31");
    expect(p.dias.length).toBe(31);
  });
  it("chave invalida vira 30 dias", () => {
    expect(resolverPeriodo("xyz", FUSO, agora).chave).toBe("30d");
  });
});

describe("leituras automaticas", () => {
  const base = {
    ocupacao: { taxa: 0.8, capacidadeMin: 6000, ocupadoMin: 4800 },
    porDiaSemana: [{ diaSemana: 2, taxa: 0.8 }, { diaSemana: 3, taxa: 0.8 }, { diaSemana: 6, taxa: 0.85 }],
    taxaFalta: 0.03,
    retorno: { base: 10, taxa: 0.7 },
    base: { ativo: 50, risco: 0, perdido: 3 },
    assinaturas: { ativas: 20, churnMensal: 0.02, assinantesSemUso: 0, valorPorUsoCentavos: 3300, tabelaPorUsoCentavos: 5000 },
    idade: { preenchidos: 30, atendidos: 50 },
    origens: { INSTAGRAM: 5 },
    novos: 5,
    bar: { comandas: 40, barPorAtendimentoCentavos: 800 },
    atendimentos: 200,
  };
  it("tudo bem: uma leitura positiva", () => {
    const l = gerarLeituras(base);
    expect(l).toHaveLength(1);
    expect(l[0].tipo).toBe("bom");
  });
  it("aponta agenda vazia, dia fraco, faltas, assinante sem uso e plano barato", () => {
    const l = gerarLeituras({
      ...base,
      ocupacao: { taxa: 0.4, capacidadeMin: 6000, ocupadoMin: 2400 },
      porDiaSemana: [{ diaSemana: 2, taxa: 0.2 }, { diaSemana: 3, taxa: 0.4 }, { diaSemana: 6, taxa: 0.9 }],
      taxaFalta: 0.12,
      assinaturas: { ...base.assinaturas, assinantesSemUso: 4, valorPorUsoCentavos: 1500 },
      automacoes: { lembreteHorasAntes: 0, reativacaoDias: 0, posAtendimento: false, aniversario: false },
    });
    const titulos = l.map((x) => x.titulo).join(" | ");
    expect(titulos).toMatch(/60 horas de cadeira vazia/);
    expect(titulos).toMatch(/Terça é o dia mais vazio/);
    expect(titulos).toMatch(/Faltas em 12%/);
    expect(titulos).toMatch(/4 assinante\(s\) sem usar/);
    expect(titulos).toMatch(/Plano rendendo pouco/);
    expect(l.find((x) => x.titulo.startsWith("Faltas"))?.texto).toMatch(/lembrete da véspera está desligado/);
  });
});
