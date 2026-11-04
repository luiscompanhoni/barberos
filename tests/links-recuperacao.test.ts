import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ pedido: vi.fn(), buscar: vi.fn(), transacao: vi.fn(), atualizar: vi.fn(), travar: vi.fn(), sync: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { linkPagamento: { findUnique: m.buscar }, $transaction: m.transacao } }));
vi.mock("@/lib/pagamentos/pagarme", () => ({ buscarPedido: m.pedido }));
vi.mock("@/lib/links/transacao", () => ({ travarLink: m.travar }));
vi.mock("@/lib/links/sincronizacao", () => ({ sincronizarLink: m.sync }));
vi.mock("@/lib/auditoria", () => ({ auditar: m.audit }));
import { recuperarPedidoLink } from "@/lib/links/recuperacao";
const referencia = "lk-link1-0123456789abcdef";
const pedido = { id: "or_teste", code: referencia, metadata: { referencia }, amount: 6000, currency: "BRL", status: "pending" };
const link = { id: "link1", status: "PENDENTE", tentativaChave: referencia, gatewayId: null, valorCentavos: 6000 };
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("PAGARME_SECRET_KEY", "sk_test_sintetica"); vi.stubEnv("AMBIENTE", "teste");
  m.pedido.mockResolvedValue(pedido); m.buscar.mockResolvedValue(link); m.travar.mockResolvedValue(link);
  m.transacao.mockImplementation(async (executar) => executar({ linkPagamento: { update: m.atualizar } }));
});
afterEach(() => vi.unstubAllEnvs());
describe("recuperação de intenção online", () => {
  it("vincula apenas o pedido consultado com referência, valor e moeda exatos", async () => {
    expect(await recuperarPedidoLink("or_teste")).toBe(true);
    expect(m.atualizar).toHaveBeenCalledWith({ where: { id: link.id }, data: { gatewayId: "or_teste" } });
    expect(m.sync).toHaveBeenCalledWith(link.id);
  });
  it.each([
    { id: "or_outro" }, { code: "outro" }, { metadata: null }, { metadata: { referencia: "cmd-1" } },
    { currency: "USD" }, { amount: 6001 },
  ])("divergência autoritativa mantém a intenção (%j)", async (extra) => {
    m.pedido.mockResolvedValue({ ...pedido, ...extra });
    expect(await recuperarPedidoLink("or_teste")).toBe(false);
    expect(m.atualizar).not.toHaveBeenCalled(); expect(m.sync).not.toHaveBeenCalled();
  });
  it("não sobrescreve outra tentativa nem outro pedido após esperar a trava", async () => {
    m.travar.mockResolvedValue({ ...link, gatewayId: "or_outro" });
    expect(await recuperarPedidoLink("or_teste")).toBe(false);
    expect(m.atualizar).not.toHaveBeenCalled();
  });
  it("erro da consulta e chave ausente não autorizam alteração", async () => {
    m.pedido.mockRejectedValue(Error("timeout"));
    expect(await recuperarPedidoLink("or_teste")).toBe(false);
    vi.stubEnv("PAGARME_SECRET_KEY", ""); m.pedido.mockClear();
    expect(await recuperarPedidoLink("or_teste")).toBe(false);
    expect(m.pedido).not.toHaveBeenCalled(); expect(m.atualizar).not.toHaveBeenCalled();
  });
  it("homologação não consulta o gateway real mesmo com chave configurada", async () => {
    vi.stubEnv("AMBIENTE", "homologacao");
    expect(await recuperarPedidoLink("or_teste")).toBe(false);
    expect(m.pedido).not.toHaveBeenCalled(); expect(m.atualizar).not.toHaveBeenCalled();
  });
});
