import { describe, expect, it } from "vitest";
import { dataPrevista, dinheiroEsperado, situacaoConciliacao, taxaSobre, totaisPorForma } from "@/lib/financeiro/regras";

describe("caixa", () => {
  it("dinheiro esperado = fundo + recebido - troco + suprimentos - sangrias", () => {
    expect(dinheiroEsperado({ fundo: 15000, recebidoDinheiro: 20000, troco: 3500, suprimentos: 5000, sangrias: 10000 })).toBe(26500);
  });
  it("totais por forma; pago antes pelo link conta como online", () => {
    const t = totaisPorForma([
      { forma: "DINHEIRO", valorCentavos: 5000, online: false },
      { forma: "PIX", valorCentavos: 6500, online: false },
      { forma: "PIX", valorCentavos: 6500, online: true },
      { forma: "CREDITO", valorCentavos: 11800, online: false },
    ]);
    expect(t).toEqual({ DINHEIRO: 5000, PIX: 6500, DEBITO: 0, CREDITO: 11800, ONLINE: 6500 });
  });
});

describe("conciliacao", () => {
  it("taxa em centesimos de % arredondada", () => {
    expect(taxaSobre(10000, 199)).toBe(199);
    expect(taxaSobre(6500, 349)).toBe(227);
    expect(taxaSobre(0, 349)).toBe(0);
  });
  it("data prevista D+N (vira o mes)", () => {
    expect(dataPrevista("2026-10-06", 1)).toBe("2026-10-07");
    expect(dataPrevista("2026-10-06", 30)).toBe("2026-11-05");
    expect(dataPrevista("2026-10-06", 0)).toBe("2026-10-06");
  });
  it("situacao com tolerancia de 1 centavo", () => {
    expect(situacaoConciliacao(9801, null)).toBe("PENDENTE");
    expect(situacaoConciliacao(9801, 9800)).toBe("CONFERIDO");
    expect(situacaoConciliacao(9801, 9500)).toBe("DIVERGENTE");
  });
});
