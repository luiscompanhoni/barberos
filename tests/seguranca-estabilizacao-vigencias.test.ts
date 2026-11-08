import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
const m = vi.hoisted(() => ({ audit: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ auditar: m.audit }));
import { competenciaSalario, competenciasRemuneracao, garantirBaselineRemuneracao, gravarVigenciaRemuneracao, lerVigenciaRemuneracao } from "@/lib/rh/vigencias";
type Row = { id: string; escopo: string; competencia: string; versao: number; conteudoJson: Prisma.JsonValue; criadoPorId: string | null; criadoEm: Date };
let rows: Row[];
const consultar = vi.fn(), criar = vi.fn();
const tx = { $executeRaw: vi.fn(), remuneracaoVersao: { findFirst: consultar, create: criar } } as unknown as Prisma.TransactionClient;
beforeEach(() => {
  vi.clearAllMocks(); rows = [];
  consultar.mockImplementation(async ({ where, orderBy }) => {
    let filtro = rows.filter(r => r.escopo === where.escopo && (!where.competencia || (typeof where.competencia === "string" ? r.competencia === where.competencia : r.competencia <= where.competencia.lte)));
    const ordem = Array.isArray(orderBy) ? orderBy : [orderBy];
    filtro = [...filtro].sort((a, b) => {
      for (const campo of ordem) {
        if (campo.competencia && a.competencia !== b.competencia) return a.competencia.localeCompare(b.competencia) * (campo.competencia === "asc" ? 1 : -1);
        if (campo.versao && a.versao !== b.versao) return (a.versao - b.versao) * (campo.versao === "asc" ? 1 : -1);
      }
      return 0;
    });
    return filtro[0] ?? null;
  });
  criar.mockImplementation(async ({ data }) => { const row = { ...data, id: `v${rows.length + 1}`, criadoEm: new Date() }; rows.push(row); return row; });
});

describe("remuneração por competência sem reescrever o passado", () => {
  it("baseline é único e fica expressamente sem homologação histórica", async () => {
    await garantirBaselineRemuneracao(tx, "salario:p1", { salarioCentavos: 1000 }, "dono");
    await garantirBaselineRemuneracao(tx, "salario:p1", { salarioCentavos: 2000 }, "dono");
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ competencia: "0001-01", conteudoJson: { conteudo: { salarioCentavos: 1000 }, origem: "BASELINE_LEGADO_NAO_HOMOLOGADO" } });
    expect(m.audit).toHaveBeenCalledOnce();
  });
  it("versões posteriores não modificam a regra de uma competência antiga", async () => {
    await garantirBaselineRemuneracao(tx, "salario:p1", { salarioCentavos: 1000 });
    await gravarVigenciaRemuneracao(tx, { escopo: "salario:p1", competencia: "2026-11", conteudo: { salarioCentavos: 2000 } });
    await gravarVigenciaRemuneracao(tx, { escopo: "salario:p1", competencia: "2026-12", conteudo: { salarioCentavos: 3000 } });
    expect((await lerVigenciaRemuneracao(tx, "salario:p1", "2026-10"))?.origem).toBe("BASELINE_LEGADO_NAO_HOMOLOGADO");
    expect((await lerVigenciaRemuneracao(tx, "salario:p1", "2026-11"))?.conteudo).toEqual({ salarioCentavos: 2000 });
    expect((await lerVigenciaRemuneracao(tx, "salario:p1", "2026-12"))?.conteudo).toEqual({ salarioCentavos: 3000 });
    expect((await lerVigenciaRemuneracao(tx, "salario:p1", "2027-01"))?.conteudo).toEqual({ salarioCentavos: 3000 });
  });
  it("alteração no mesmo mês acrescenta versão e repetição JSON canônica não duplica", async () => {
    await gravarVigenciaRemuneracao(tx, { escopo: "config", competencia: "2026-11", conteudo: { a: 1, b: 2 } });
    await gravarVigenciaRemuneracao(tx, { escopo: "config", competencia: "2026-11", conteudo: { b: 2, a: 1 } });
    await gravarVigenciaRemuneracao(tx, { escopo: "config", competencia: "2026-11", conteudo: { b: 2, a: 3 } });
    expect(rows).toHaveLength(2); expect(rows.map(r => r.versao)).toEqual([1, 2]);
    expect(rows[0].conteudoJson).toMatchObject({ conteudo: { a: 1 } });
    expect((await lerVigenciaRemuneracao(tx, "config", "2026-11"))?.versao).toBe(2);
  });
  it("competência padrão é o mês seguinte no fuso da barbearia, inclusive virada de ano", () => {
    expect(competenciasRemuneracao(new Date("2026-12-01T01:30:00Z"))).toEqual({ atual: "2026-11", proxima: "2026-12" });
    expect(competenciasRemuneracao(new Date("2026-12-31T20:00:00Z"))).toEqual({ atual: "2026-12", proxima: "2027-01" });
    expect(competenciaSalario(undefined, new Date("2026-11-08T12:00:00Z"))).toBe("2026-12");
    expect(competenciaSalario("2026-11", new Date("2026-11-08T12:00:00Z"))).toBe("2026-11");
    expect(() => competenciaSalario("2026-10", new Date("2026-11-08T12:00:00Z"))).toThrow("passada");
  });
  it("não assume remuneração quando não há registro ou o envelope está corrompido", async () => {
    expect(await lerVigenciaRemuneracao(tx, "ausente", "2026-11")).toBeNull();
    rows.push({ id: "fixture", escopo: "corrompido", competencia: "2026-11", versao: 1, conteudoJson: { salario: 1 }, criadoPorId: null, criadoEm: new Date() });
    await expect(lerVigenciaRemuneracao(tx, "corrompido", "2026-11")).rejects.toMatchObject({ codigo: "remuneracao_invalida" });
  });
  it("reserva o mês de baseline e recusa competência inválida", async () => {
    await expect(gravarVigenciaRemuneracao(tx, { escopo: "salario:p1", competencia: "0001-01", conteudo: {} })).rejects.toThrow("reservada");
    await expect(gravarVigenciaRemuneracao(tx, { escopo: "salario:p1", competencia: "2026-13", conteudo: {} })).rejects.toThrow();
    expect(criar).not.toHaveBeenCalled();
  });
});
