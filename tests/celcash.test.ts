import { describe, expect, it } from "vitest";
import { converter, traduzirStatus } from "@/lib/pagamentos/celcash";

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
  const pix = { galaxPayId: 10, subscriptionGalaxPayId: 7, value: 11800, payday: "2099-01-01", status: "pendingPix", Pix: { qrCode: "000201...", image: "https://img", page: "https://pagina-pix" } };
  it("Pix usa a pagina e o copia e cola da transacao", () => {
    const c = converter(pix, { mainPaymentMethodId: "pix", paymentLink: "https://link-assinatura" });
    expect(c).toMatchObject({ id: "celtx_10", assinaturaGatewayId: "celsub_7", valorCentavos: 11800, forma: "PIX", link: "https://pagina-pix", pixCopiaECola: "000201...", status: "PENDENTE", pagaEm: null });
  });
  it("cartao usa o link da assinatura (cadastro do cartao)", () => {
    const c = converter({ ...pix, Pix: null, status: "captured", paydayDate: "2099-01-02" }, { mainPaymentMethodId: "creditcard", paymentLink: "https://link-assinatura" });
    expect(c).toMatchObject({ forma: "CARTAO", link: "https://link-assinatura", status: "PAGA", pagaEm: "2099-01-02", pixCopiaECola: null });
  });
});
