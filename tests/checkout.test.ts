import { describe, expect, it } from "vitest";
import {
  erroNovoLink, formaNaComanda, formatarContagem, motivoLinkFechado, parcelasValidas, pixVencido, segundosRestantes, situacaoLink,
  textoEnvioLink, validadePixSeg, valorParcela,
} from "@/lib/pagamentos/checkout-regras";
import { provedorPorId } from "@/lib/pagamentos/gateway";
import { converterPedido, motivoRecusa } from "@/lib/pagamentos/pagarme";
import { alvosDoWebhook } from "@/lib/pagamentos/webhook-pagarme";

describe("gateway pelo prefixo do id", () => {
  it("Celcash continua na Celcash com qualquer provedor no env", () => {
    for (const id of ["celsub_1", "celtx_2", "celchg_3", "celcli_4"]) {
      expect(provedorPorId(id, "pagarme")).toBe("celcash");
      expect(provedorPorId(id, "simulado")).toBe("celcash");
    }
  });
  it("ids da Pagar.me", () => {
    for (const id of ["sub_1", "ch_2", "or_3", "cus_4", "in_5", "pixrec_abc"]) expect(provedorPorId(id, "celcash")).toBe("pagarme");
  });
  it("simulado e Asaas", () => {
    expect(provedorPorId("simsub_1", "pagarme")).toBe("simulado");
    expect(provedorPorId("simchg_1", "celcash")).toBe("simulado");
    expect(provedorPorId("pay_123", "pagarme")).toBe("asaas");
    // sub_/cus_ do Asaas so quando o Asaas e o provedor atual
    expect(provedorPorId("sub_1", "asaas")).toBe("asaas");
  });
  it("desconhecido segue o provedor do env", () => {
    expect(provedorPorId("xyz", "celcash")).toBe("celcash");
    expect(provedorPorId("123", "pagarme")).toBe("pagarme");
  });
});

describe("validade do Pix", () => {
  const agora = Date.parse("2026-10-06T12:00:00Z");
  it("1 dia, sem passar do limite, nunca menos de 5 min", () => {
    expect(validadePixSeg(null, agora)).toBe(86_400);
    expect(validadePixSeg(agora + 3 * 86_400_000, agora)).toBe(86_400);
    expect(validadePixSeg(agora + 2 * 3_600_000, agora)).toBe(7_200);
    expect(validadePixSeg(agora + 60_000, agora)).toBe(300);
    expect(validadePixSeg(new Date(agora - 1000), agora)).toBe(300);
  });
  it("vencido e contagem", () => {
    expect(pixVencido(null, agora)).toBe(false);
    expect(pixVencido(new Date(agora + 30_000), agora)).toBe(true);
    expect(pixVencido(new Date(agora + 3_600_000).toISOString(), agora)).toBe(false);
    expect(segundosRestantes(new Date(agora + 125_500), agora)).toBe(125);
    expect(segundosRestantes(new Date(agora - 1), agora)).toBe(0);
    expect(segundosRestantes(null, agora)).toBeNull();
    expect(formatarContagem(125)).toBe("02:05");
    expect(formatarContagem(3725)).toBe("1h 02min");
    expect(formatarContagem(-5)).toBe("00:00");
  });
});

describe("parcelas", () => {
  it("dentro do permitido pelo link", () => {
    expect(parcelasValidas(undefined, 1)).toBe(1);
    expect(parcelasValidas(3, 3)).toBe(3);
    expect(parcelasValidas(4, 3)).toBeNull();
    expect(parcelasValidas(0, 3)).toBeNull();
    expect(parcelasValidas(2.5, 3)).toBeNull();
    expect(parcelasValidas(13, 20)).toBeNull(); // teto de 12
  });
  it("valor da parcela arredonda para cima", () => {
    expect(valorParcela(10000, 3)).toBe(3334);
    expect(valorParcela(9000, 3)).toBe(3000);
  });
});

describe("links de pagamento", () => {
  const agora = Date.parse("2026-10-06T12:00:00Z");
  const futuro = new Date(agora + 86_400_000);
  it("situacao e motivo para nao pagar", () => {
    expect(situacaoLink({ status: "PENDENTE", expiraEm: futuro }, agora)).toBe("PENDENTE");
    expect(situacaoLink({ status: "PENDENTE", expiraEm: new Date(agora - 1) }, agora)).toBe("EXPIRADO");
    expect(situacaoLink({ status: "PAGO", expiraEm: new Date(agora - 1) }, agora)).toBe("PAGO");
    expect(motivoLinkFechado({ status: "PENDENTE", expiraEm: futuro }, agora)).toBeNull();
    expect(motivoLinkFechado({ status: "CANCELADO", expiraEm: futuro }, agora)).toMatch(/cancelado/);
    expect(motivoLinkFechado({ status: "PENDENTE", expiraEm: new Date(agora - 1) }, agora)).toMatch(/expirou/);
  });
  it("criacao: valor, validade, parcelas e o que falta na comanda", () => {
    const base = { valorCentavos: 5000, validadeDias: 3, parcelasMax: 1 };
    expect(erroNovoLink(base)).toBeNull();
    expect(erroNovoLink({ ...base, valorCentavos: 50 })).toMatch(/R\$ 1,00/);
    expect(erroNovoLink({ ...base, validadeDias: 31 })).toMatch(/validade/);
    expect(erroNovoLink({ ...base, parcelasMax: 13 })).toMatch(/Parcelas/);
    expect(erroNovoLink({ ...base, faltaComanda: 0 })).toMatch(/já está paga/);
    expect(erroNovoLink({ ...base, faltaComanda: 4999 })).toMatch(/maior/);
    expect(erroNovoLink({ ...base, faltaComanda: 5000 })).toBeNull();
  });
  it("forma do pagamento na comanda e mensagem do WhatsApp", () => {
    expect(formaNaComanda("CARTAO")).toBe("CREDITO");
    expect(formaNaComanda("PIX")).toBe("PIX");
    const t = textoEnvioLink({ nome: "João Silva", descricao: "Pomada", valorCentavos: 4500, url: "https://x/c/link/abc", expiraEm: futuro, barbearia: "Black Barber" });
    expect(t).toContain("Oi, João!");
    expect(t).toContain("https://x/c/link/abc");
    expect(t).toContain("07/10");
    expect(t).toMatch(/R\$\s?45,00/);
  });
});

describe("pedido avulso da Pagar.me", () => {
  it("Pix pendente com QR e validade", () => {
    const c = converterPedido({
      id: "or_1", status: "pending",
      charges: [{ id: "ch_1", amount: 4500, status: "pending", payment_method: "pix", last_transaction: { qr_code: "000201", qr_code_url: "https://qr", expires_at: "2026-10-07T12:00:00Z" } }],
    });
    expect(c).toMatchObject({ id: "or_1", status: "PENDENTE", forma: "PIX", pixCopiaECola: "000201", pixQrUrl: "https://qr", expiraEm: "2026-10-07T12:00:00Z", erro: null, link: null });
  });
  it("cartao pago, recusado e cancelado", () => {
    expect(converterPedido({ id: "or_2", status: "paid", charges: [{ id: "ch", amount: 1, status: "paid", payment_method: "credit_card", paid_at: "2026-10-06T10:00:00Z" }] }))
      .toMatchObject({ status: "PAGA", forma: "CARTAO", pagaEm: "2026-10-06T10:00:00Z", pixCopiaECola: null });
    const r = converterPedido({ id: "or_3", status: "failed", charges: [{ id: "ch", amount: 1, status: "failed", payment_method: "credit_card", last_transaction: { acquirer_message: "Saldo insuficiente" } }] });
    expect(r.status).toBe("ATRASADA");
    expect(r.erro).toBe("O cartão não foi aceito: Saldo insuficiente");
    expect(converterPedido({ id: "or_4", status: "canceled", charges: [] }).status).toBe("CANCELADA");
    expect(converterPedido({ id: "or_5", status: "failed", charges: [] }).status).toBe("ATRASADA");
    expect(converterPedido({ id: "or_6", status: "paid", charges: [
      { id: "a", amount: 1, status: "failed", payment_method: "credit_card" }, { id: "b", amount: 1, status: "paid", payment_method: "pix" },
    ] }).status).toBe("PAGA");
  });
  it("mensagem de recusa", () => {
    expect(motivoRecusa(null)).toMatch(/Confira os dados/);
    expect(motivoRecusa({ gateway_response: { errors: [{ message: "Cartão expirado" }] } })).toBe("O cartão não foi aceito: Cartão expirado");
  });
});

describe("webhook da Pagar.me", () => {
  it("pedido, cobrancas e assinatura cancelada", () => {
    expect(alvosDoWebhook(null)).toBeNull();
    expect(alvosDoWebhook({ id: "hook_1", type: "order.paid" })).toBeNull();
    expect(alvosDoWebhook({ id: "hook_1", type: "order.paid", data: { id: "or_1", charges: [{ id: "ch_1" }] } }))
      .toMatchObject({ evento: "hook_1", pedido: "or_1", cobrancas: ["ch_1"], assinaturaCancelada: null });
    expect(alvosDoWebhook({ id: "h", type: "charge.paid", data: { id: "ch_9", order: { id: "or_9" } } })).toMatchObject({ pedido: "or_9", cobrancas: ["ch_9"] });
    expect(alvosDoWebhook({ id: "h", type: "invoice.paid", data: { id: "in_1", charge: { id: "ch_2" } } })).toMatchObject({ pedido: null, cobrancas: ["ch_2"] });
    expect(alvosDoWebhook({ id: "h", type: "subscription.canceled", data: { id: "sub_1" } })).toMatchObject({ assinaturaCancelada: "sub_1", cobrancas: [] });
  });
});
