import { describe, expect, it } from "vitest";
import { projetarRecorrenciaSimuladaDezembro } from "@/lib/oferta-dezembro/cronograma-simulado";

describe("recorrência simulada de Dezembro Grátis", () => {
  it("agenda o cartão para meia-noite em São Paulo e não cria débito em dezembro", () => {
    expect(projetarRecorrenciaSimuladaDezembro(9900, new Date("2027-01-01T02:59:59.999Z"))).toEqual({
      start_at: "2027-01-01T03:00:00.000Z", payment_method: "credit_card", ciclosSimulados: [],
    });
  });

  it("simula o primeiro débito no início de janeiro, pelo preço contratado", () => {
    const { ciclosSimulados } = projetarRecorrenciaSimuladaDezembro(9900, new Date("2027-01-01T03:00:00.000Z"));
    expect(ciclosSimulados).toEqual([
      { competencia: "2027-01-01", debitoEm: "2027-01-01T03:00:00.000Z", valorCentavos: 9900, fidelidade: true },
    ]);
  });

  it("lista as seis competências da fidelidade e para simulações a partir do cancelamento", () => {
    const agora = new Date("2027-07-02T03:00:00Z");
    const { ciclosSimulados } = projetarRecorrenciaSimuladaDezembro(9900, agora);
    expect(ciclosSimulados.filter(c => c.fidelidade).map(c => c.competencia)).toEqual([
      "2027-01-01", "2027-02-01", "2027-03-01", "2027-04-01", "2027-05-01", "2027-06-01",
    ]);
    expect(ciclosSimulados.at(-1)).toMatchObject({ competencia: "2027-07-01", fidelidade: false });
    const antesDaPrimeira = new Date("2027-01-01T02:59:59.999Z");
    const comUma = new Date("2027-02-01T03:00:00Z");
    expect(projetarRecorrenciaSimuladaDezembro(9900, agora, antesDaPrimeira).ciclosSimulados).toEqual([]);
    expect(projetarRecorrenciaSimuladaDezembro(9900, agora, comUma).ciclosSimulados).toHaveLength(1);
  });
});
