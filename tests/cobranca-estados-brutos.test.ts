import { describe, expect, it } from "vitest";
import { converter as converterAsaas } from "@/lib/pagamentos/asaas";
import { converter as converterCelcash } from "@/lib/pagamentos/celcash";
import { converterCobranca as converterPagarme } from "@/lib/pagamentos/pagarme";

describe("somente estados brutos reconhecidos autorizam aviso", () => {
  it("Asaas preserva forma explícita e não inventa para UNDEFINED ou ausência", () => {
    const p = { id: "pay_1", subscription: "sub_1", value: 10, dueDate: "2031-01-01", status: "PENDING" };
    expect(converterAsaas({ ...p, billingType: "CREDIT_CARD" })).toMatchObject({ forma: "CARTAO", abertaConfirmada: true });
    expect(converterAsaas({ ...p, billingType: "PIX" }).forma).toBe("PIX");
    expect(converterAsaas({ ...p, billingType: "BOLETO" }).forma).toBe("BOLETO");
    expect(converterAsaas({ ...p, billingType: "UNDEFINED" }).forma).toBeNull();
    expect(converterAsaas(p).forma).toBeNull();
    expect(converterAsaas({ ...p, status: "OVERDUE" }).abertaConfirmada).toBe(true);
    for (const status of ["STATUS_NOVO", "RECEIVED", "REFUNDED"]) expect(converterAsaas({ ...p, status }).abertaConfirmada).toBe(false);
    expect(converterAsaas({ ...p, deleted: true }).abertaConfirmada).toBe(false);
  });
  it("Celcash recusa estado desconhecido ou recusado sem criar expiração", () => {
    const p = { galaxPayId: 1, subscriptionGalaxPayId: 2, value: 1000, payday: "2031-01-01", status: "pendingPix", Pix: { qrCode: "pix", page: "https://exemplo.invalid" } };
    expect(converterCelcash(p, { mainPaymentMethodId: "pix" }).abertaConfirmada).toBe(true);
    expect(converterCelcash(p, { mainPaymentMethodId: "pix" }).expiraEm).toBeUndefined();
    for (const status of ["unknown", "denied", "unavailablePix", "authorized"]) expect(converterCelcash({ ...p, status }, { mainPaymentMethodId: "pix" }).abertaConfirmada).toBe(false);
  });
  it("Pagar.me só aceita pending, não estados desconhecidos ou em processamento", () => {
    const p = { id: "ch_1", amount: 1000, status: "pending", payment_method: "credit_card" };
    expect(converterPagarme(p).abertaConfirmada).toBe(true);
    expect(converterPagarme(p).vencimentoConfirmado).toBe(false);
    expect(converterPagarme({ ...p, due_at: "2031-01-01T12:00:00Z" }).vencimentoConfirmado).toBe(true);
    for (const status of ["unknown", "processing", "underpaid", "failed", "paid"]) expect(converterPagarme({ ...p, status }).abertaConfirmada).toBe(false);
  });
});
