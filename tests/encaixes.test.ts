import { describe, expect, it } from "vitest";
import { erroDuracao, janelasParaEncaixe } from "@/lib/agenda/encaixes-regras";

const min = (m: number) => m * 60_000;
const base = { janelas: [{ inicio: 0, fim: min(40) }], bloqueios: [], agendamentos: [], duracaoMin: 20, intervaloMin: 0, granularidadeMin: 5, agora: 0 };

describe("capacidade real de encaixe", () => {
  it("40 minutos comportam dois serviços de 20, não cinco horários alternativos", () => {
    expect(janelasParaEncaixe(base)).toEqual([{ inicio: 0, fim: min(40), quantidade: 2 }]);
  });
  it("desconta intervalo entre os serviços novos", () => {
    expect(janelasParaEncaixe({ ...base, intervaloMin: 5 })[0].quantidade).toBe(1);
  });
  it("respeita granularidade ao começar o segundo serviço", () => {
    expect(janelasParaEncaixe({ ...base, duracaoMin: 18, granularidadeMin: 15 })[0].quantidade).toBe(1);
  });
  it("reduzir de 30 para 20 libera dez minutos, sem prometer encaixe de vinte", () => {
    expect(janelasParaEncaixe({ ...base, janelas: [{ inicio: 0, fim: min(30) }], agendamentos: [{ inicio: 0, fim: min(20) }] })).toEqual([]);
    expect(janelasParaEncaixe({ ...base, janelas: [{ inicio: 0, fim: min(30) }], agendamentos: [{ inicio: 0, fim: min(20) }], duracaoMin: 10 })[0].quantidade).toBe(1);
  });
  it("não atravessa pausa ou bloqueio nem reaproveita tempo passado", () => {
    expect(janelasParaEncaixe({ ...base, bloqueios: [{ inicio: min(10), fim: min(25) }] })).toEqual([]);
    expect(janelasParaEncaixe({ ...base, agora: min(21) })).toEqual([]);
  });
  it("respeita limpeza ao redor de compromissos existentes", () => {
    expect(janelasParaEncaixe({ ...base, janelas: [{ inicio: 0, fim: min(60) }], agendamentos: [{ inicio: min(20), fim: min(40) }], intervaloMin: 5 })).toEqual([]);
  });
});

describe("limites de duração", () => {
  it("aceita duração no mínimo e recusa duração menor ou fracionária", () => {
    expect(erroDuracao(20, 20)).toBeNull();
    expect(erroDuracao(19, 20)).toBeTruthy();
    expect(erroDuracao(20.5, 20)).toBeTruthy();
    expect(erroDuracao(481, 20)).toBeTruthy();
  });
});
