import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModalidadeComissao } from "@prisma/client";
import type { Sessao } from "@/lib/auth/sessao";
type Linha = { id: string; barbeiroId: string; modalidade: ModalidadeComissao; pontosBps: number; motivo: string; inicio: Date; fim: Date | null; autorizadoPorId: string; criadoEm: Date };
const m = vi.hoisted(() => ({
  estado: { adicionais: [] as Linha[], fechadas: [] as string[], auditorias: [] as unknown[] },
  inicioTx: vi.fn(), auditar: vi.fn(),
}));
vi.mock("@/lib/agenda/carregar", () => ({ configuracao: async () => ({ fuso: "America/Sao_Paulo" }) }));
vi.mock("@/lib/auditoria", () => ({ auditar: m.auditar }));
vi.mock("@/lib/db", () => {
  let fila = Promise.resolve();
  const base = {
    barbeiro: { findUnique: async () => ({ nome: "Profissional sintético" }) },
    folhaPagamento: { findMany: async () => m.estado.fechadas.map(competencia => ({ competencia })) },
    adicionalComissao: {
      findUnique: async ({ where }: { where: { id: string } }) => structuredClone(m.estado.adicionais.find(a => a.id === where.id) ?? null),
      findMany: async ({ where }: { where: { barbeiroId: string; modalidade: string; id?: { not: string } } }) => structuredClone(m.estado.adicionais.filter(a => a.barbeiroId === where.barbeiroId && a.modalidade === where.modalidade && a.id !== where.id?.not)),
      create: async ({ data }: { data: Omit<Linha, "id" | "criadoEm"> }) => {
        const a = { ...data, id: `adicional-${m.estado.adicionais.length + 1}`, criadoEm: new Date() }; m.estado.adicionais.push(a); return structuredClone(a);
      },
      update: async ({ where, data }: { where: { id: string }; data: { fim: Date } }) => {
        const a = m.estado.adicionais.find(a => a.id === where.id)!; Object.assign(a, data); return structuredClone(a);
      },
      delete: async ({ where }: { where: { id: string } }) => { m.estado.adicionais = m.estado.adicionais.filter(a => a.id !== where.id); },
    },
  };
  return { db: { ...base, $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    await m.inicioTx();
    let liberar = () => {}, antes: typeof m.estado | undefined;
    const tx = { ...base, $executeRaw: vi.fn(), $queryRaw: async (sql: TemplateStringsArray) => {
      if (sql.join("").includes("rh:adicionais")) {
        const anterior = fila; fila = new Promise<void>(resolve => { liberar = resolve; }); await anterior;
        antes = structuredClone(m.estado);
      }
      return sql.join("").includes("checklist_pessoas") ? [{ id: "pessoa" }] : [];
    } };
    try { return await fn(tx); } catch (e) { if (antes) m.estado = antes; throw e; } finally { liberar(); }
  } } };
});
import { criarAdicional, encerrarAdicional, excluirAdicional } from "@/lib/rh/adicionais";

const s: Sessao = { usuarioId: "dono", nome: "Dono sintético", papel: "DONO", clienteId: null, barbeiroId: null };
const entrada = { barbeiroId: "barbeiro", modalidade: "AVULSO" as const, pontosBps: 500, motivo: "Motivo sintético", inicio: "2026-11-01", fim: null };
const linha = (extra: Partial<Linha> = {}): Linha => ({ ...entrada, id: "existente", inicio: new Date("2026-11-01"), fim: null, autorizadoPorId: "dono", criadoEm: new Date(), ...extra });
beforeEach(() => {
  vi.clearAllMocks(); m.estado = { adicionais: [], fechadas: [], auditorias: [] };
  m.inicioTx.mockReset(); m.auditar.mockImplementation(async (...args: unknown[]) => { m.estado.auditorias.push(args.slice(1)); });
  vi.spyOn(Date, "now").mockReturnValue(+new Date("2026-11-08T12:00:00Z"));
});
afterEach(() => vi.restoreAllMocks());

describe("adicionais revalidados dentro da transação", () => {
  it("rejeita criação se a competência fechou antes da fase de gravação", async () => {
    m.inicioTx.mockImplementationOnce(() => { m.estado.fechadas.push("2026-11"); });
    await expect(criarAdicional(s, entrada)).rejects.toMatchObject({ codigo: "folha_fechada" });
    expect(m.estado.adicionais).toEqual([]); expect(m.estado.auditorias).toEqual([]);
  });
  it("dois pedidos simultâneos não criam períodos sobrepostos", async () => {
    const r = await Promise.allSettled([criarAdicional(s, entrada), criarAdicional(s, { ...entrada, inicio: "2026-11-02" })]);
    expect(r.filter(x => x.status === "fulfilled")).toHaveLength(1);
    expect(m.estado.adicionais).toHaveLength(1); expect(m.estado.auditorias).toHaveLength(1);
  });
  it("encerramento reconsulta a vigência atual e protege o período que realmente mudou", async () => {
    m.estado.adicionais.push(linha({ fim: new Date("2026-11-20") }));
    m.estado.fechadas.push("2026-12");
    m.inicioTx.mockImplementationOnce(() => { m.estado.adicionais[0].fim = null; });
    await expect(encerrarAdicional(s, "existente", "2026-11-10")).rejects.toMatchObject({ codigo: "folha_fechada" });
    expect(m.estado.adicionais[0].fim).toBeNull();
  });
  it("prorrogar uma vigência não invade um adicional posterior", async () => {
    m.estado.adicionais.push(linha({ fim: new Date("2026-11-10") }), linha({ id: "seguinte", inicio: new Date("2026-11-20") }));
    await expect(encerrarAdicional(s, "existente", "2026-11-25")).rejects.toMatchObject({ codigo: "sobreposto" });
    expect(m.estado.adicionais[0].fim).toEqual(new Date("2026-11-10"));
  });
  it("não exclui adicional futuro de competência já fechada", async () => {
    m.estado.adicionais.push(linha({ inicio: new Date("2026-12-01") }));
    m.inicioTx.mockImplementationOnce(() => { m.estado.fechadas.push("2026-12"); });
    await expect(excluirAdicional(s, "existente")).rejects.toMatchObject({ codigo: "folha_fechada" });
    expect(m.estado.adicionais).toHaveLength(1);
  });
  it("falha da auditoria desfaz criação, encerramento e exclusão", async () => {
    m.auditar.mockRejectedValueOnce(Error("auditoria-indisponivel"));
    await expect(criarAdicional(s, entrada)).rejects.toThrow("auditoria-indisponivel");
    expect(m.estado.adicionais).toEqual([]);
    m.estado.adicionais.push(linha({ inicio: new Date("2026-12-01") }));
    m.auditar.mockRejectedValueOnce(Error("auditoria-indisponivel"));
    await expect(encerrarAdicional(s, "existente", "2026-12-10")).rejects.toThrow("auditoria-indisponivel");
    expect(m.estado.adicionais[0].fim).toBeNull();
    m.auditar.mockRejectedValueOnce(Error("auditoria-indisponivel"));
    await expect(excluirAdicional(s, "existente")).rejects.toThrow("auditoria-indisponivel");
    expect(m.estado.adicionais).toHaveLength(1);
  });
});
