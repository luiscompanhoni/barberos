import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Sessao } from "@/lib/auth/sessao";
const m = vi.hoisted(() => ({ caixa: vi.fn(), caixaAntigo: vi.fn(), despesa: vi.fn(), atualizar: vi.fn(), auditar: vi.fn(), transacao: vi.fn(), claims: 1, passos: [] as string[] }));
vi.mock("@/lib/auditoria", () => ({ auditar: m.auditar }));
vi.mock("@/lib/agenda/carregar", () => ({ configuracao: async () => ({ fuso: "America/Sao_Paulo" }) }));
vi.mock("@/lib/financeiro/caixa", () => ({ movimentarCaixa: m.caixaAntigo, movimentarCaixaNaTransacao: m.caixa }));
vi.mock("@/lib/db", () => {
  const pessoa = async () => ({ id: "pessoa", nome: "Pessoa sintética" });
  const folha = async () => ({ id: "folha", status: "FECHADA", liquidoCentavos: 10000, salarioCentavos: 10000, comissaoCentavos: 0, adicionaisCentavos: 0, descontosCentavos: 0 });
  const tx = { $queryRaw: async () => [{ id: "pessoa" }], $executeRaw: async () => { m.passos.push("pessoa"); return 1; },
    checklistPessoa: { findUnique: pessoa }, folhaPagamento: { findUnique: folha,
    updateMany: async () => { m.passos.push("claim"); const count = Math.max(0, m.claims); m.claims = 0; return { count }; },
    update: m.atualizar,
  }, despesa: { create: m.despesa } };
  return { db: { $transaction: m.transacao.mockImplementation(async f => f(tx)) } };
});
import { pagarFolha } from "@/lib/rh/folha";
const s = { usuarioId: "dono", papel: "DONO", nome: "Dono", barbeiroId: null, clienteId: null } as Sessao;
beforeEach(() => {
  vi.clearAllMocks(); m.claims = 1; m.passos.length = 0;
  m.caixa.mockImplementation(async () => { m.passos.push("caixa"); return { id: "movimento" }; });
  m.despesa.mockImplementation(async () => { m.passos.push("despesa"); return { id: "despesa" }; });
});
describe("folha: registro em dinheiro atômico", () => {
  it("reserva a folha antes da sangria e usa a transação da despesa", async () => {
    await pagarFolha(s, "2039-11", "pessoa", "DINHEIRO_CAIXA");
    expect(m.passos).toEqual(["pessoa", "claim", "caixa", "despesa"]);
    const tx = m.caixa.mock.calls[0][0]; expect(tx.despesa.create).toBe(m.despesa);
    expect(m.caixa).toHaveBeenCalledWith(tx, s, "SANGRIA", 10000, "Folha 11/2039");
    expect(m.despesa.mock.calls[0][0].data.movimentoCaixaId).toBe("movimento"); expect(m.caixaAntigo).not.toHaveBeenCalled();
  });
  it("repetição concorrente não gera outra sangria nem despesa", async () => {
    const r = await Promise.allSettled([pagarFolha(s, "2039-11", "pessoa", "DINHEIRO_CAIXA"), pagarFolha(s, "2039-11", "pessoa", "DINHEIRO_CAIXA")]);
    expect(r.filter(x => x.status === "fulfilled")).toHaveLength(1); expect(m.caixa).toHaveBeenCalledTimes(1); expect(m.despesa).toHaveBeenCalledTimes(1);
  });
  it("falha ao reservar não chama movimentação do caixa", async () => {
    m.claims = 0;
    await expect(pagarFolha(s, "2039-11", "pessoa", "DINHEIRO_CAIXA")).rejects.toMatchObject({ codigo: "ja_paga" });
    expect(m.caixa).not.toHaveBeenCalled(); expect(m.despesa).not.toHaveBeenCalled();
  });
  it("falha do caixa interrompe a mesma transação antes da despesa", async () => {
    m.caixa.mockRejectedValueOnce(new Error("Saldo insuficiente sintético"));
    await expect(pagarFolha(s, "2039-11", "pessoa", "DINHEIRO_CAIXA")).rejects.toThrow("Saldo insuficiente"); expect(m.despesa).not.toHaveBeenCalled();
  });
  it("registro Pix mantém o comportamento manual sem executar movimentação bancária ou de caixa", async () => {
    await pagarFolha(s, "2039-11", "pessoa", "PIX");
    expect(m.caixa).not.toHaveBeenCalled(); expect(m.caixaAntigo).not.toHaveBeenCalled(); expect(m.despesa).toHaveBeenCalledTimes(1);
  });
});
