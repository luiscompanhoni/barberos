import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  buscar: vi.fn(), transicao: vi.fn(), agregado: vi.fn(), alvo: vi.fn(), auditar: vi.fn(),
  pagamento: vi.fn(), atualizarPagamento: vi.fn(), consultarTrava: vi.fn(), estornar: vi.fn(),
}));
vi.mock("@/lib/db", () => {
  const tx = {
    pedidoEstorno: { findUniqueOrThrow: m.buscar, updateMany: m.transicao, aggregate: m.agregado, findFirst: async () => null },
    pagamentoComanda: { findUniqueOrThrow: m.pagamento, update: m.atualizarPagamento },
    $queryRaw: m.consultarTrava, $executeRaw: m.consultarTrava,
    usuario: { findUnique: async () => ({ ativo: true, papel: "DONO" }) },
  };
  return { db: { ...tx, $transaction: (fn: (tx: unknown) => unknown) => fn(tx) } };
});
vi.mock("@/lib/auditoria", () => ({ auditar: m.auditar }));
vi.mock("@/lib/estornos/alvo", () => ({ carregarAlvo: m.alvo }));
vi.mock("@/lib/pagamentos/pagarme", () => ({ estornarCobranca: m.estornar }));
vi.mock("@/lib/eventos", () => ({ publicar: vi.fn() }));
vi.mock("@/lib/financeiro/caixa", () => ({ movimentarCaixa: vi.fn() }));
import { executarEstorno, registrarManual } from "@/lib/estornos/executar";
import type { Sessao } from "@/lib/auth/sessao";

const s = { usuarioId: "dono-teste", papel: "DONO" } as Sessao;
const p = { id: "est-1", status: "APROVADO", instrucao: null, meio: "MAQUININHA", valorCentavos: 5000, valorOriginalCentavos: 5000, tipo: "COMANDA", referenciaId: "pg-1" };
beforeEach(() => {
  vi.resetAllMocks();
  m.buscar.mockResolvedValue(p);
  m.transicao.mockResolvedValue({ count: 1 });
  m.alvo.mockResolvedValue({ comandaId: "cmd-1", pagamentoComandaId: "pg-1", gatewayId: "or_pos", valorOriginal: 5000 });
  m.agregado.mockResolvedValue({ _sum: { valorCentavos: 0 } });
  m.pagamento.mockResolvedValue({ valorCentavos: 5000, estornadoCentavos: 0 });
});

describe("estorno Stone POS sem efeito financeiro antecipado", () => {
  it("aprovação só registra instrução e nunca chama a API online ou baixa pagamento", async () => {
    await executarEstorno(s, p.id);
    expect(m.transicao).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: p.id, status: "APROVADO", instrucao: null },
      data: expect.objectContaining({ instrucao: expect.stringMatching(/portal Stone/) }),
    }));
    expect(m.estornar).not.toHaveBeenCalled();
    expect(m.atualizarPagamento).not.toHaveBeenCalled();
  });
  it("confirmação sem comprovante não altera financeiro", async () => {
    await expect(registrarManual(s, p.id, " ")).rejects.toMatchObject({ codigo: "comprovante_estorno" });
    expect(m.transicao).not.toHaveBeenCalled();
  });
  it("referência confirmada aplica efeitos uma vez sob a trava da comanda e audita", async () => {
    await registrarManual(s, p.id, "Comprovante Stone 123");
    expect(m.consultarTrava).toHaveBeenCalled();
    expect(m.atualizarPagamento).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "CANCELADO", estornadoCentavos: 5000 }),
    }));
    expect(m.auditar).toHaveBeenCalledWith(expect.anything(), s.usuarioId, "estorno_manual", "estorno", p.id,
      expect.objectContaining({ referenciaComprovante: "Comprovante Stone 123" }));
    expect(m.estornar).not.toHaveBeenCalled();
  });
  it("transição repetida não reaplica os efeitos", async () => {
    m.transicao.mockResolvedValue({ count: 0 });
    await registrarManual(s, p.id, "Comprovante Stone 123");
    expect(m.atualizarPagamento).not.toHaveBeenCalled();
    expect(m.auditar).not.toHaveBeenCalled();
  });
  it("pedido já concluído não pode ser confirmado novamente", async () => {
    m.buscar.mockResolvedValue({ ...p, status: "MANUAL" });
    await expect(registrarManual(s, p.id, "Comprovante Stone 123")).rejects.toMatchObject({ codigo: "ja_decidido" });
    expect(m.atualizarPagamento).not.toHaveBeenCalled();
  });
  it("não confirma novamente uma devolução já conciliada pelo webhook", async () => {
    m.pagamento.mockResolvedValue({ valorCentavos: 5000, estornadoCentavos: 1000 });
    m.agregado.mockResolvedValue({ _sum: { valorCentavos: 1000 } });
    await expect(registrarManual(s, p.id, "Comprovante Stone 123")).rejects.toMatchObject({ codigo: "estorno_conciliado" });
    expect(m.transicao).not.toHaveBeenCalled();
    expect(m.atualizarPagamento).not.toHaveBeenCalled();
  });
});
