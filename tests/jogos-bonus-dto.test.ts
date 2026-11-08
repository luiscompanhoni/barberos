import { beforeEach, describe, expect, it, vi } from "vitest";
import { TODOS_PADRAO } from "@/lib/jogos/padroes";

const m = vi.hoisted(() => ({ jogos: vi.fn(), situacao: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  jogo: { findMany: m.jogos }, jogada: { findMany: async () => [] }, jogoPremio: { findMany: async () => [] },
  premioGanho: { count: async () => 0 },
} }));
vi.mock("@/lib/assinaturas/servico", () => ({ situacaoDoCliente: m.situacao }));
vi.mock("@/lib/auditoria", () => ({ auditar: vi.fn(), origemDaRequisicao: vi.fn() }));
vi.mock("@/lib/jogos/fichas", () => ({ contarFichas: async () => new Map(), comoGanhar: () => [], fichasLivres: vi.fn(), sincronizarFichas: vi.fn() }));
import { centralDoCliente, jogoDoCliente } from "@/lib/jogos/motor";

function jogos(bonus = [15, 50]) {
  return TODOS_PADRAO.map((j, i) => ({ ...j, ativo: i < 2, inicioEm: null, fimEm: null, bonusAssinantePct: bonus[i] ?? 0 }));
}
beforeEach(() => {
  m.jogos.mockResolvedValue(jogos());
  m.situacao.mockResolvedValue({ valida: true });
});

describe("bônus por jogo no contrato da área do cliente", () => {
  it("central preserva regras diferentes e não anuncia o bônus do primeiro jogo para todos", async () => {
    const c = await centralDoCliente("cliente-ficticio");
    expect(c.jogos.map(j => j.multiplicador)).toEqual([115, 150]);
    expect(c.multiplicador).toBeNull();
  });
  it("detalhe do segundo jogo usa seu próprio bônus e mantém 15% exatos no primeiro", async () => {
    expect((await jogoDoCliente("cliente-ficticio", TODOS_PADRAO[1].id)).multiplicador).toBe(150);
    expect((await jogoDoCliente("cliente-ficticio", TODOS_PADRAO[0].id)).multiplicador).toBe(115);
  });
  it("cliente sem assinatura não recebe promessa de bônus", async () => {
    m.situacao.mockResolvedValue(null);
    const c = await centralDoCliente("cliente-ficticio");
    expect(c.jogos.map(j => j.multiplicador)).toEqual([100, 100]);
    expect(c.multiplicador).toBe(100);
  });
  it("compatibilidade global só representa jogos com o mesmo valor; central vazia não inventa bônus", async () => {
    m.jogos.mockResolvedValue(jogos([15, 15]));
    expect((await centralDoCliente("cliente-ficticio")).multiplicador).toBe(115);
    m.jogos.mockResolvedValue(jogos().map(j => ({ ...j, ativo: false })));
    expect((await centralDoCliente("cliente-ficticio")).multiplicador).toBeNull();
  });
});
