import { describe, expect, it } from "vitest";
import { ocupacaoPorDia } from "@/components/painel/dados-visao-crm";
describe("ocupação exibida no gráfico do painel", () => {
  it("mantém ausência de histórico diferente de ocupação zero", () => {
    expect(ocupacaoPorDia({ dias: 30, linhas: [{ diaSemana: 0, valores: [null, null] }, { diaSemana: 1, valores: [0, 0] }] })).toEqual([null, 0]);
  });
  it("calcula só as faixas disponíveis, sem fabricar valores para dias fechados", () => {
    expect(ocupacaoPorDia({ dias: 30, linhas: [{ diaSemana: 1, valores: [null, .5, 1] }] })).toEqual([75]);
  });
  it("não limita sobreocupação nem deixa não finitos contaminarem a série", () => {
    expect(ocupacaoPorDia({ dias: 30, linhas: [{ diaSemana: 1, valores: [1.2, NaN] }] })).toEqual([120]);
  });
});
