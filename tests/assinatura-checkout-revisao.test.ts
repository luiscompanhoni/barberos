import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ assinatura: vi.fn(), atual: vi.fn(), ultima: vi.fn(), abertas: vi.fn(), sincronizar: vi.fn(), gateway: vi.fn(), atualizarCartao: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { assinatura: { findUnique: m.assinatura, findUniqueOrThrow: m.atual }, cobranca: { findFirst: m.ultima, findMany: m.abertas } } }));
vi.mock("@/lib/assinaturas/cobrancas", () => ({ sincronizarAssinatura: m.sincronizar, sincronizarCobranca: vi.fn(), cobrancaEmAberto: vi.fn() }));
vi.mock("@/lib/pagamentos/gateway", () => ({ gateway: m.gateway, gatewayPorId: m.gateway }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => createElement("a", { href }, children) }));
vi.mock("@/components/checkout/CartaoForm", () => ({ CartaoForm: ({ rotuloBotao }: { rotuloBotao: string }) => createElement("p", null, `FORMULARIO_CARTAO ${rotuloBotao}`) }));
vi.mock("@/components/checkout/PixPainel", () => ({ PixPainel: () => createElement("p", null, "PAINEL_PIX") }));
import { checkoutDaAssinatura, trocarCartao } from "@/lib/assinaturas/cartao-pix";
import { ErroPagarme } from "@/lib/pagamentos/pagarme";
import { Checkout } from "@/components/checkout/Checkout";
import type { EstadoCheckout } from "@/lib/pagamentos/checkout-regras";

const inicial = { id: "assinatura", status: "PENDENTE", gatewayId: "sub_recusada", formaPagamento: "CARTAO", operacaoInicial: null };
const tela = (estado: EstadoCheckout, troca = false) => renderToStaticMarkup(createElement(Checkout, {
  alvo: { tipo: "assinatura", token: "token-ficticio" }, resumo: { titulo: "Plano", valorCentavos: 10000 },
  formas: ["CARTAO", "PIX"], modoCartao: "teste", chavePublica: null, inicial: estado, troca,
}));
beforeEach(() => {
  vi.clearAllMocks(); m.assinatura.mockResolvedValue(inicial); m.atual.mockResolvedValue(inicial);
  m.ultima.mockResolvedValue({ status: "ATRASADA" }); m.abertas.mockResolvedValue([]); m.sincronizar.mockResolvedValue(undefined);
  m.gateway.mockResolvedValue({ atualizarCartao: m.atualizarCartao }); m.atualizarCartao.mockResolvedValue(undefined);
});

describe("checkout da primeira operação", () => {
  it("recusa com contrato existente mantém pagamento bloqueado e oferece cancelamento", async () => {
    const estado = await checkoutDaAssinatura("token-ficticio", false);
    expect(estado).toMatchObject({ status: "PENDENTE", forma: "CARTAO", processando: true });
    const html = tela(estado);
    expect(html).toContain("O primeiro pagamento foi recusado");
    expect(html).toContain("Cancelar operação ou trocar pagamento");
    expect(html).not.toContain("FORMULARIO_CARTAO"); expect(html).not.toContain("Tentar outro cartão");
    expect(html.match(/role="tab" disabled=""/g)).toHaveLength(2);
  });
  it("sem contrato permite escolher e iniciar o primeiro pagamento", async () => {
    m.assinatura.mockResolvedValue({ ...inicial, gatewayId: null });
    const estado = await checkoutDaAssinatura("token-ficticio", false);
    expect(estado.processando).toBe(false); expect(tela(estado)).toContain("FORMULARIO_CARTAO");
  });
  it("Pix iniciado bloqueia aba cartão até cancelar, mantendo a leitura do Pix", () => {
    const html = tela({ status: "PENDENTE", forma: "PIX", pix: { copiaECola: "pix-ficticio", qrUrl: null, expiraEm: null }, link: null });
    expect(html.match(/role="tab" disabled=""/g)).toHaveLength(1);
    expect(html).toContain("PAINEL_PIX"); expect(html).toContain("Cancelar operação ou trocar pagamento");
  });
  it.each(["CARTAO", "PIX"])("cancelamento durante conferência %s nunca aparece como pagamento recebido", async forma => {
    m.assinatura.mockResolvedValue({ ...inicial, formaPagamento: forma, gatewayId: forma === "PIX" ? "pixrec_teste" : "sub_recusada" });
    m.atual.mockResolvedValue({ ...inicial, status: "CANCELADA" });
    const estado = await checkoutDaAssinatura("token-ficticio");
    expect(estado.status).toBe("CANCELADO");
    const html = tela(estado);
    expect(html).toContain("Pagamento cancelado"); expect(html).not.toContain("confirmado.");
    expect(html).toContain("Escolher plano e forma de pagamento");
  });
  it("plano já pago não comprova troca de cartão", async () => {
    m.assinatura.mockResolvedValue({ ...inicial, status: "ATIVA" });
    const pago = await checkoutDaAssinatura("token-ficticio", false);
    expect(pago.status).toBe("PAGO");
    const html = tela(pago, true);
    expect(html).toContain("Salvar novo cartão");
    expect(html).not.toContain("confirmado."); expect(html).not.toContain("atualizado.");
  });
  it.each([new TypeError("Timeout"), new ErroPagarme(502, "indisponível"), new ErroPagarme(401, "credencial")])("falha não comprovada de atualização não vira recusa de pagamento: %s", async erro => {
    m.assinatura.mockResolvedValue({ ...inicial, status: "ATIVA" }); m.atualizarCartao.mockRejectedValue(erro);
    await expect(trocarCartao("token-ficticio", "token-cartao-teste")).rejects.toMatchObject({ status: 503, codigo: "cartao_atualizacao_revisao" });
    expect(m.sincronizar).not.toHaveBeenCalled();
  });
  it("resposta explícita inválida permite corrigir o cartão sem anunciar sucesso", async () => {
    m.atualizarCartao.mockRejectedValue(new ErroPagarme(422, "token inválido"));
    await expect(trocarCartao("token-ficticio", "token-cartao-teste")).rejects.toMatchObject({ status: 422, codigo: "cartao_recusado" });
    expect(m.sincronizar).not.toHaveBeenCalled();
  });
  it("retorna sucesso apenas depois de atualizar e sincronizar", async () => {
    await expect(trocarCartao("token-ficticio", "token-cartao-teste")).resolves.toEqual(inicial);
    expect(m.atualizarCartao).toHaveBeenCalledWith(inicial.gatewayId, "token-cartao-teste"); expect(m.sincronizar).toHaveBeenCalledWith(inicial.id);
  });
});
