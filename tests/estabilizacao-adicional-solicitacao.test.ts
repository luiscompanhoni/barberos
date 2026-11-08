import { describe, expect, it } from "vitest";
import { encerrarSolicitacaoAdicional, solicitacaoAdicional } from "@/components/comandas/solicitacao-adicional";
import { schemaAcaoComanda } from "@/lib/comandas/schemas";

describe("adicional: a intenção permanece identificada após timeout", () => {
  const storage = () => {
    const dados = new Map<string, string>();
    return { getItem: (k: string) => dados.get(k) ?? null, setItem: (k: string, v: string) => { dados.set(k, v); }, removeItem: (k: string) => { dados.delete(k); } };
  };
  it("repete a mesma chave após erro de rede e recarregamento da tela", () => {
    const s = storage(), memoria = new Map<string, string>();
    const primeira = solicitacaoAdicional(memoria, "comanda", "corte", "barbeiro", s);
    expect(solicitacaoAdicional(memoria, "comanda", "corte", "barbeiro", s)).toBe(primeira);
    expect(solicitacaoAdicional(new Map(), "comanda", "corte", "barbeiro", s)).toBe(primeira);
    expect(solicitacaoAdicional(memoria, "outra-comanda", "corte", "barbeiro", s)).not.toBe(primeira);
  });
  it("uma inclusão confirmada permite outra intenção explícita", () => {
    const s = storage(), memoria = new Map<string, string>();
    const primeira = solicitacaoAdicional(memoria, "comanda", "corte", "barbeiro", s);
    encerrarSolicitacaoAdicional(memoria, "comanda", "corte", "barbeiro", s);
    expect(solicitacaoAdicional(memoria, "comanda", "corte", "barbeiro", s)).not.toBe(primeira);
  });
  it("continua protegendo a tentativa em memória quando armazenamento é bloqueado", () => {
    const s = { getItem: () => { throw Error("bloqueado"); }, setItem: () => { throw Error("bloqueado"); }, removeItem: () => { throw Error("bloqueado"); } };
    const memoria = new Map<string, string>(), primeira = solicitacaoAdicional(memoria, "c", "s", "b", s);
    expect(solicitacaoAdicional(memoria, "c", "s", "b", s)).toBe(primeira);
    expect(() => encerrarSolicitacaoAdicional(memoria, "c", "s", "b", s)).not.toThrow();
  });
  it("API exige chave UUID antes de lançar o serviço", () => {
    const corpo = { acao: "servico", servicoId: "s", barbeiroId: "b" };
    expect(schemaAcaoComanda.safeParse(corpo).success).toBe(false);
    expect(schemaAcaoComanda.safeParse({ ...corpo, solicitacaoId: "invalido" }).success).toBe(false);
    expect(schemaAcaoComanda.safeParse({ ...corpo, solicitacaoId: crypto.randomUUID() }).success).toBe(true);
  });
});
