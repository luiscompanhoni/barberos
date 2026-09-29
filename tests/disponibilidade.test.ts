import { describe, expect, it } from "vitest";
import {
  contido,
  horariosLivres,
  janelasDeTrabalho,
  subtrair,
  unir,
} from "@/lib/agenda/disponibilidade";
import { dataLocal, diaSemana, instanteLocal, minParaHhmm, minutosLocal } from "@/lib/agenda/tempo";

const FUSO = "America/Sao_Paulo";
const DATA = "2026-09-29"; // terca-feira
const t = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return instanteLocal(DATA, h * 60 + m, FUSO);
};
const hh = (ms: number) => minParaHhmm(minutosLocal(ms, FUSO));

// Terca: 9h-12h e 13h-19h (almoco 12-13)
const semana = [
  { diaSemana: 2, inicioMin: 9 * 60, fimMin: 12 * 60 },
  { diaSemana: 2, inicioMin: 13 * 60, fimMin: 19 * 60 },
  { diaSemana: 3, inicioMin: 9 * 60, fimMin: 19 * 60 },
];

describe("tempo", () => {
  it("converte hora local de Sao Paulo para UTC (-03:00)", () => {
    expect(new Date(t("09:00")).toISOString()).toBe("2026-09-29T12:00:00.000Z");
    expect(dataLocal(t("23:30"), FUSO)).toBe(DATA);
    expect(diaSemana(DATA)).toBe(2);
  });
});

describe("janelasDeTrabalho", () => {
  it("usa a semana padrao do dia", () => {
    const j = janelasDeTrabalho(DATA, semana, null, FUSO);
    expect(j.map((i) => [hh(i.inicio), hh(i.fim)])).toEqual([
      ["09:00", "12:00"],
      ["13:00", "19:00"],
    ]);
  });

  it("folga zera o dia", () => {
    expect(janelasDeTrabalho(DATA, semana, { tipo: "FOLGA" }, FUSO)).toEqual([]);
  });

  it("horario especial substitui a semana (inclui dia extra)", () => {
    const domingo = "2026-10-04";
    const j = janelasDeTrabalho(
      domingo,
      semana,
      { tipo: "HORARIO_ESPECIAL", intervalos: [{ inicioMin: 540, fimMin: 780 }] },
      FUSO,
    );
    expect(j).toHaveLength(1);
    expect(minutosLocal(j[0].inicio, FUSO)).toBe(540);
  });

  it("dia sem expediente fica vazio", () => {
    expect(janelasDeTrabalho("2026-10-04", semana, null, FUSO)).toEqual([]);
  });
});

describe("unir / subtrair / contido", () => {
  it("junta intervalos encostados", () => {
    expect(unir([{ inicio: 5, fim: 10 }, { inicio: 0, fim: 5 }])).toEqual([{ inicio: 0, fim: 10 }]);
  });
  it("subtrai buracos no meio e nas pontas", () => {
    expect(
      subtrair([{ inicio: 0, fim: 100 }], [
        { inicio: -5, fim: 10 },
        { inicio: 40, fim: 50 },
        { inicio: 90, fim: 200 },
      ]),
    ).toEqual([
      { inicio: 10, fim: 40 },
      { inicio: 50, fim: 90 },
    ]);
  });
  it("contido exige caber numa janela so (nao atravessa o almoco)", () => {
    const j = janelasDeTrabalho(DATA, semana, null, FUSO);
    expect(contido({ inicio: t("11:30"), fim: t("12:00") }, j)).toBe(true);
    expect(contido({ inicio: t("11:45"), fim: t("12:15") }, j)).toBe(false);
  });
});

describe("horariosLivres", () => {
  const base = {
    janelas: janelasDeTrabalho(DATA, semana, null, FUSO),
    bloqueios: [],
    agendamentos: [],
    duracaoMin: 30,
    granularidadeMin: 15,
    intervaloEntreClientesMin: 0,
    naoAntesDe: 0,
  };

  it("gera a grade de 15 em 15 e respeita o almoco", () => {
    const h = horariosLivres(base).map(hh);
    expect(h[0]).toBe("09:00");
    expect(h).toContain("11:30");
    expect(h).not.toContain("11:45"); // terminaria 12:15
    expect(h).toContain("13:00");
    expect(h[h.length - 1]).toBe("18:30");
  });

  it("pula atendimentos existentes", () => {
    const h = horariosLivres({
      ...base,
      agendamentos: [{ inicio: t("10:00"), fim: t("10:40") }],
    }).map(hh);
    expect(h).toContain("09:30");
    expect(h).not.toContain("09:45"); // terminaria 10:15
    expect(h).not.toContain("10:30");
    expect(h).toContain("10:45"); // arredonda 10:40 para a grade
  });

  it("aplica o intervalo entre clientes", () => {
    const h = horariosLivres({
      ...base,
      intervaloEntreClientesMin: 10,
      agendamentos: [{ inicio: t("10:00"), fim: t("10:30") }],
    }).map(hh);
    expect(h).not.toContain("09:30"); // terminaria 10:00, sem os 10 min
    expect(h).toContain("09:15");
    expect(h).not.toContain("10:30");
    expect(h).toContain("10:45");
  });

  it("respeita bloqueios (agenda fechada)", () => {
    const h = horariosLivres({
      ...base,
      bloqueios: [{ inicio: t("13:00"), fim: t("19:00") }],
    }).map(hh);
    expect(h[h.length - 1]).toBe("11:30");
  });

  it("respeita antecedencia minima e alinha na grade", () => {
    const h = horariosLivres({ ...base, naoAntesDe: t("14:07") }).map(hh);
    expect(h[0]).toBe("14:15");
  });

  it("servico maior que qualquer buraco nao gera horario", () => {
    expect(horariosLivres({ ...base, duracaoMin: 7 * 60 })).toEqual([]);
  });
});
