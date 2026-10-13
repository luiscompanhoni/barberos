import { describe, expect, it } from "vitest";
import { hhmmParaMinutos, nivelDoFuncionario, progressoNivel, tarefasDoDia, textoLista, textoRe, textoResumo } from "@/lib/checklist/regras";

const T = (id: string, funcao: string, extra: Partial<{ diasSemana: number[]; horario: string | null; ordem: number; ativo: boolean }> = {}) =>
  ({ id, titulo: id, funcao, diasSemana: [], horario: null, ordem: 0, ativo: true, ...extra });

describe("checklist", () => {
  it("tarefas do dia: funcao, dias da semana e ordem por horario", () => {
    const ts = [
      T("toalhas", "DIARISTA", { diasSemana: [1, 3, 5] }),
      T("banheiro", "DIARISTA", { horario: "08:30" }),
      T("varrer", "DIARISTA", { horario: "08:00" }),
      T("bancada", "BARBEIRO"),
      T("antiga", "DIARISTA", { ativo: false }),
    ];
    expect(tarefasDoDia(ts, "DIARISTA", 1).map((t) => t.id)).toEqual(["varrer", "banheiro", "toalhas"]);
    expect(tarefasDoDia(ts, "DIARISTA", 2).map((t) => t.id)).toEqual(["varrer", "banheiro"]);
    expect(tarefasDoDia(ts, "BARBEIRO", 0).map((t) => t.id)).toEqual(["bancada"]);
  });
  it("hora em minutos", () => {
    expect(hhmmParaMinutos("08:00")).toBe(480);
    expect(hhmmParaMinutos("19:30")).toBe(1170);
    expect(hhmmParaMinutos("x")).toBeNaN();
  });
  it("mensagem da lista tem as tarefas numeradas e o link", () => {
    const t = textoLista({ nome: "Maria Silva", data: "2026-10-06", diaSemana: 2, itens: [{ titulo: "Varrer", horario: "08:00" }, { titulo: "Lixo", horario: null }], link: "https://x/t/abc" });
    expect(t).toContain("Bom dia, Maria!");
    expect(t).toContain("terça, 06/10");
    expect(t).toContain("1. 08:00 · Varrer");
    expect(t).toContain("2. Lixo");
    expect(t).toContain("https://x/t/abc");
  });
  it("resumo: tudo feito, pendencias por pessoa, ou nada a mandar", () => {
    expect(textoResumo({ data: "2026-10-06", feitas: 3, total: 3, pendentes: [], link: "l" })).toContain("todas as 3 tarefas");
    const r = textoResumo({ data: "2026-10-06", feitas: 1, total: 3, pendentes: [{ nome: "Maria", titulo: "Lixo" }, { nome: "Maria", titulo: "Toalhas" }], link: "l" })!;
    expect(r).toContain("1 de 3");
    expect(r).toContain("*Maria*\n- Lixo\n- Toalhas");
    expect(textoResumo({ data: "2026-10-06", feitas: 0, total: 0, pendentes: [], link: "l" })).toBeNull();
  });
});

describe("pontos e faixas", () => {
  const cfg = { nivelPlatina: 500, nivelLegend: 1500 };
  it("faixa pelo total acumulado (negativo continua ELITE)", () => {
    expect(nivelDoFuncionario(-40, cfg)).toBe("ELITE");
    expect(nivelDoFuncionario(0, cfg)).toBe("ELITE");
    expect(nivelDoFuncionario(499, cfg)).toBe("ELITE");
    expect(nivelDoFuncionario(500, cfg)).toBe("PLATINA");
    expect(nivelDoFuncionario(1499, cfg)).toBe("PLATINA");
    expect(nivelDoFuncionario(1500, cfg)).toBe("LEGEND");
    expect(nivelDoFuncionario(9999, cfg)).toBe("LEGEND");
  });
  it("progresso ate a proxima faixa", () => {
    expect(progressoNivel(250, cfg)).toEqual({ nivel: "ELITE", proximo: "PLATINA", faltam: 250, percentual: 50 });
    expect(progressoNivel(-30, cfg)).toEqual({ nivel: "ELITE", proximo: "PLATINA", faltam: 530, percentual: 0 });
    expect(progressoNivel(1000, cfg)).toEqual({ nivel: "PLATINA", proximo: "LEGEND", faltam: 500, percentual: 50 });
    expect(progressoNivel(2000, cfg)).toEqual({ nivel: "LEGEND", proximo: null, faltam: 0, percentual: 100 });
  });
  it("mensagem da re", () => {
    const t = textoRe({ nome: "Maria Silva", titulo: "Lixo", pontos: 20, motivo: "lixo cheio", link: "https://x/t/abc" });
    expect(t).toContain("Maria, você tomou uma ré 😬");
    expect(t).toContain('"Lixo" (−20 pts)');
    expect(t).toContain("Motivo: lixo cheio");
    expect(t).toContain("https://x/t/abc");
  });
});
