import { describe, expect, it } from "vitest";
import { contarPorFaixa, diasDesde, faixaUltimaVisita, nomeComparavel, nomesRepetidos } from "@/lib/clientes/segmentos";

const DIA = 86_400_000;

describe("faixas de ultima visita", () => {
  it("limites de cada faixa", () => {
    expect(faixaUltimaVisita(null)).toBe("Nunca veio");
    expect(faixaUltimaVisita(0)).toBe("0–30 dias");
    expect(faixaUltimaVisita(30)).toBe("0–30 dias");
    expect(faixaUltimaVisita(31)).toBe("31–60 dias");
    expect(faixaUltimaVisita(60)).toBe("31–60 dias");
    expect(faixaUltimaVisita(61)).toBe("61–90 dias");
    expect(faixaUltimaVisita(90)).toBe("61–90 dias");
    expect(faixaUltimaVisita(91)).toBe("91–180 dias");
    expect(faixaUltimaVisita(180)).toBe("91–180 dias");
    expect(faixaUltimaVisita(181)).toBe("+180 dias");
  });

  it("dias desde a ultima visita e contagem com todas as faixas", () => {
    const agora = Date.UTC(2026, 9, 14, 12);
    expect(diasDesde(null, agora)).toBeNull();
    expect(diasDesde(agora - 45.5 * DIA, agora)).toBe(45);
    expect(contarPorFaixa([1, 45, 45, null])).toEqual({
      "0–30 dias": 1, "31–60 dias": 2, "61–90 dias": 0, "91–180 dias": 0, "+180 dias": 0, "Nunca veio": 1,
    });
  });
});

describe("possiveis duplicados", () => {
  it("compara sem acento e pontuacao e ignora nome de uma palavra", () => {
    expect(nomeComparavel("  João  da Silva. ")).toBe("joao da silva");
    const g = nomesRepetidos([
      { nome: "João da Silva", telefone: "1" }, { nome: "JOAO DA SILVA", telefone: "2" },
      { nome: "Lucas", telefone: "3" }, { nome: "lucas", telefone: "4" }, { nome: "Pedro Souza", telefone: "5" },
    ]);
    expect(g).toHaveLength(1);
    expect(g[0].map((c) => c.telefone)).toEqual(["1", "2"]);
  });
});
