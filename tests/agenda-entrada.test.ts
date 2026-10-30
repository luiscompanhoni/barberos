import { describe, expect, it } from "vitest";
import { entradaAgenda, queryEntradaAgenda } from "@/lib/agenda/entrada";

describe("links de Meu dia para a agenda", () => {
  const q = { data: "2026-10-30", barbeiroId: "igor", servicoId: "corte", encaixes: "1" };
  it("gestor preserva data, profissional e serviço com encaixes abertos", () => {
    const entrada = entradaAgenda(q, { papel: "DONO", barbeiroId: null });
    expect(entrada).toEqual({ dataInicial: "2026-10-30", barbeiroInicial: "igor", servicoInicial: "corte", encaixesInicial: true });
    expect(queryEntradaAgenda(entrada)).toBe("data=2026-10-30&barbeiroId=igor&servicoId=corte&encaixes=1");
  });
  it("barbeiro não troca o próprio escopo por parâmetro de URL", () => {
    expect(entradaAgenda(q, { papel: "BARBEIRO", barbeiroId: "fauli" }).barbeiroInicial).toBe("fauli");
  });
  it("minha agenda preserva vínculo próprio mesmo para gerente que atende", () => {
    expect(entradaAgenda(q, { papel: "GERENTE", barbeiroId: "gerente-barbeiro" }, true).barbeiroInicial).toBe("gerente-barbeiro");
  });
  it("descarta datas impossíveis e parâmetros repetidos sem quebrar a página", () => {
    expect(entradaAgenda({ data: "2026-02-30", barbeiroId: ["a", "b"], encaixes: "true" }, { papel: "DONO", barbeiroId: null })).toEqual({ dataInicial: undefined, barbeiroInicial: undefined, servicoInicial: undefined, encaixesInicial: false });
  });
});
