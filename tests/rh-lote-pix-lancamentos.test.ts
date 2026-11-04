import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Sessao } from "@/lib/auth/sessao";
type Registro = { id: string; pessoaId: string; competencia: string; tipo: string; valorCentavos: number; descricao: string; movimentoCaixaId: string | null; porId: string };
const m = vi.hoisted(() => ({ registros: new Map<string, Registro>(), caixa: vi.fn(), auditoria: vi.fn(), historico: vi.fn(), fechada: vi.fn(), criar: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ auditar: m.auditoria }));
vi.mock("@/lib/financeiro/caixa", () => ({ movimentarCaixaNaTransacao: m.caixa }));
vi.mock("@/lib/db", () => {
  const tx = { $queryRaw: async () => [], auditoria: { findFirst: m.historico }, checklistPessoa: { findUnique: async () => ({ id: "pessoa1", nome: "Pessoa sintética" }) }, folhaPagamento: { findUnique: m.fechada }, folhaLancamento: { findUnique: async ({ where }: { where: { id: string } }) => m.registros.get(where.id) ?? null, create: m.criar } };
  return { db: { $transaction: async (f: (t: typeof tx) => unknown) => f(tx) } };
});
import { lancar } from "@/lib/rh/folha";
const s = { usuarioId: "dono1", papel: "DONO", nome: "Dono", barbeiroId: null, clienteId: null } as Sessao;
const d = { competencia: "2039-11", pessoaId: "pessoa1", tipo: "VALE" as const, valorCentavos: 10000, descricao: "Vale sintético", doCaixa: true, idempotencia: "173d07ec-335b-4d11-9af6-680cb8afc86d" };
beforeEach(() => {
  vi.clearAllMocks(); m.registros.clear(); m.fechada.mockResolvedValue(null); m.historico.mockResolvedValue(null); m.caixa.mockResolvedValue({ id: "movimento1" });
  m.criar.mockImplementation(async ({ data }) => { m.registros.set(data.id, data); return data; });
});
describe("lançamento manual com chave durável", () => {
  it("replay exato retorna o mesmo registro sem outra sangria ou auditoria", async () => {
    const a = await lancar(s, d), b = await lancar(s, d);
    expect(a.id).toBe(d.idempotencia); expect(b.id).toBe(a.id); expect(m.criar).toHaveBeenCalledTimes(1); expect(m.caixa).toHaveBeenCalledTimes(1); expect(m.auditoria).toHaveBeenCalledTimes(1);
    expect(m.caixa.mock.calls[0][0].folhaLancamento.create).toBe(m.criar);
  });
  it("resposta perdida pode ser recuperada depois do fechamento da folha", async () => {
    await lancar(s, d); m.fechada.mockResolvedValue({ status: "FECHADA" });
    expect((await lancar(s, d)).id).toBe(d.idempotencia); expect(m.fechada).toHaveBeenCalledTimes(1); expect(m.caixa).toHaveBeenCalledTimes(1);
  });
  it.each([{ pessoaId: "pessoa2" }, { competencia: "2039-12" }, { valorCentavos: 20000 }, { descricao: "Outro vale" }, { doCaixa: false }, { tipo: "BONUS" as const }])("mesma chave com dados diferentes é recusada %j", async extra => {
    await lancar(s, d);
    await expect(lancar(s, { ...d, ...extra })).rejects.toMatchObject({ status: 409, codigo: "lancamento_idempotencia" }); expect(m.caixa).toHaveBeenCalledTimes(1); expect(m.criar).toHaveBeenCalledTimes(1);
  });
  it("mesma chave de outro autor não cria nem apropria o registro", async () => {
    await lancar(s, d);
    await expect(lancar({ ...s, usuarioId: "dono2" }, d)).rejects.toMatchObject({ codigo: "lancamento_idempotencia" }); expect(m.caixa).toHaveBeenCalledTimes(1);
  });
  it("nova chave em folha já fechada falha antes da movimentação", async () => {
    m.fechada.mockResolvedValue({ status: "FECHADA" });
    await expect(lancar(s, d)).rejects.toMatchObject({ codigo: "folha_fechada" }); expect(m.caixa).not.toHaveBeenCalled(); expect(m.criar).not.toHaveBeenCalled();
  });
  it("falha de caixa não grava lançamento ou auditoria", async () => {
    m.caixa.mockRejectedValueOnce(new Error("Falha sintética"));
    await expect(lancar(s, d)).rejects.toThrow("Falha sintética"); expect(m.criar).not.toHaveBeenCalled(); expect(m.auditoria).not.toHaveBeenCalled();
  });
  it("chave de lançamento removido permanece indisponível por seu histórico imutável", async () => {
    m.historico.mockResolvedValue({ id: "audit-criacao" });
    await expect(lancar(s, { ...d, doCaixa: false })).rejects.toMatchObject({ codigo: "lancamento_removido" }); expect(m.criar).not.toHaveBeenCalled(); expect(m.caixa).not.toHaveBeenCalled();
  });
});
