import { describe, expect, it } from "vitest";
import { converterPedido } from "@/lib/pagamentos/pagarme";
import { liquidacaoDoLinkConfere } from "@/lib/links/valores";
const charge = { id: "ch_1", amount: 6000, currency: "BRL", status: "paid", paid_amount: 6000 };
const pedido = { id: "or_teste", status: "paid", amount: 6000, currency: "BRL", charges: [charge] };

describe("prova monetária de pedidos Pagar.me", () => {
  it("usa paid_amount autoritativo e moeda, sem alterar a tradução legada de status", () => {
    const c = converterPedido(pedido);
    expect(c).toMatchObject({ status: "PAGA", valorCentavos: 6000, moeda: "BRL", liquidadoCentavos: 6000 });
    expect(liquidacaoDoLinkConfere(c, 6000)).toBe(true);
  });
  it("devolução parcial sai do valor recebido e não inclui tarifas", () => {
    const c = converterPedido({ ...pedido, charges: [{ ...charge, canceled_amount: 1000 }] });
    expect(c.status).toBe("PAGA"); expect(c.liquidadoCentavos).toBe(5000); expect(liquidacaoDoLinkConfere(c, 6000)).toBe(false);
  });
  it("soma cobranças distintas sem permitir que uma parcial quite o total do pedido", () => {
    const c = converterPedido({ ...pedido, charges: [{ ...charge, amount: 2000, paid_amount: 2000 }, { ...charge, id: "ch_2", amount: 4000, paid_amount: 4000 }] });
    expect(liquidacaoDoLinkConfere(c, 6000)).toBe(true);
    expect(liquidacaoDoLinkConfere(converterPedido({ ...pedido, charges: [{ ...charge, amount: 2000, paid_amount: 2000 }] }), 6000)).toBe(false);
  });
  it.each([
    { paid_amount: undefined }, { paid_amount: -1 }, { paid_amount: 6001 }, { currency: "USD" }, { canceled_amount: 6001 },
  ])("prova ausente/inconsistente não é fabricada pelo status (%j)", (extra) => {
    const c = converterPedido({ ...pedido, charges: [{ ...charge, ...extra }] });
    expect(c.liquidadoCentavos).toBeUndefined(); expect(liquidacaoDoLinkConfere(c, 6000)).toBe(false);
  });
  it("cobrança duplicada e moeda ausente não confirmam liquidação", () => {
    expect(converterPedido({ ...pedido, charges: [charge, charge] }).liquidadoCentavos).toBeUndefined();
    expect(liquidacaoDoLinkConfere(converterPedido({ ...pedido, currency: undefined }), 6000)).toBe(false);
  });
});
