import { describe, expect, it } from "vitest";
import { converter, converterAvulsa, traduzirStatus } from "@/lib/pagamentos/celcash";

describe("Celcash: status", () => {
  const hoje = "2026-10-05";
  it("pagos", () => {
    for (const s of ["captured", "payedPix", "payedBoleto", "payExternal", "free"]) expect(traduzirStatus(s, hoje, hoje)).toBe("PAGA");
  });
  it("em aberto vira atrasada so depois do vencimento", () => {
    expect(traduzirStatus("pendingPix", "2026-10-05", hoje)).toBe("PENDENTE");
    expect(traduzirStatus("pendingPix", "2026-10-04", hoje)).toBe("ATRASADA");
    expect(traduzirStatus("notSend", "2026-10-10", hoje)).toBe("PENDENTE");
  });
  it("recusado, estornado e cancelado", () => {
    expect(traduzirStatus("denied", "2026-10-10", hoje)).toBe("ATRASADA");
    expect(traduzirStatus("reversed", hoje, hoje)).toBe("ESTORNADA");
    expect(traduzirStatus("chargeback", hoje, hoje)).toBe("ESTORNADA");
    expect(traduzirStatus("cancelByContract", hoje, hoje)).toBe("CANCELADA");
  });
});

describe("Celcash: conversao da transacao", () => {
  it("avulsa exige valor e instante efetivo sem confundir pago externo ou transações múltiplas", () => {
    const t = { galaxPayId: 1, value: 8000, payday: "2026-11-09", paydayDateDateTime: "2026-11-09 12:00:00", status: "payedPix" };
    const c = { galaxPayId: 2, mainPaymentMethodId: "pix", Transactions: [t] };
    expect(converterAvulsa(c)).toMatchObject({ id: "celchg_2", valorCentavos: 8000, liquidadoCentavos: 8000, moeda: "BRL", pagaEm: "2026-11-09T15:00:00.000Z" });
    expect(converterAvulsa({ ...c, value: 9000 }).valorCentavos).toBeUndefined();
    expect(converterAvulsa({ ...c, Transactions: [{ ...t, paydayDateDateTime: undefined }] }).liquidadoCentavos).toBeUndefined();
    expect(converterAvulsa({ ...c, Transactions: [{ ...t, payedOutsideGalaxPay: true }] }).liquidadoCentavos).toBeUndefined();
    expect(converterAvulsa({ ...c, Transactions: [t, { ...t, galaxPayId: 3 }] }).liquidadoCentavos).toBeUndefined();
  });
  const pix = { galaxPayId: 10, subscriptionGalaxPayId: 7, value: 11800, payday: "2099-01-01", status: "pendingPix", Pix: { qrCode: "000201...", image: "https://img", page: "https://pagina-pix" } };
  it("Pix usa a pagina e o copia e cola da transacao", () => {
    const c = converter(pix, { mainPaymentMethodId: "pix", paymentLink: "https://link-assinatura" });
    expect(c).toMatchObject({ id: "celtx_10", assinaturaGatewayId: "celsub_7", valorCentavos: 11800, forma: "PIX", link: "https://pagina-pix", pixCopiaECola: "000201...", status: "PENDENTE", pagaEm: null });
  });
  it("cartao usa o link da assinatura (cadastro do cartao)", () => {
    const c = converter({ ...pix, Pix: null, status: "captured", paydayDate: "2099-01-01", paydayDateDateTime: "2099-01-02 10:00:00" }, { mainPaymentMethodId: "creditcard", paymentLink: "https://link-assinatura" });
    expect(c).toMatchObject({ forma: "CARTAO", link: "https://link-assinatura", status: "PAGA", pagaEm: "2099-01-02T13:00:00.000Z", pixCopiaECola: null });
  });
});
