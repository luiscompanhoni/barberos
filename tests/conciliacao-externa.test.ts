import { describe, expect, it } from "vitest";
import { classificarCelcash, contraparte, divergente, ehContaPropria, resumirExtrato, type MovimentoCelcash } from "@/lib/conciliacao/regras";

const PROPRIAS = ["BLACK BARBER", "BLACK BARBEARIA"];
const m = (groupPaymentType: string, paymentType: string, value: number, friendlyDescription = "Transação #1"): MovimentoCelcash =>
  ({ galaxPayId: 1, value, friendlyDescription, createdAt: "2026-10-13 06:06:57", groupPaymentType, paymentType, transactionGalaxPayId: 7005 });
const tipo = (x: MovimentoCelcash) => classificarCelcash(x, PROPRIAS);

describe("classificacao do extrato da Celcash", () => {
  it("cartao: recebimento, taxa, antecipacao e estorno", () => {
    expect(tipo(m("subacquirer", "subacquirerCredit", 129.9))).toEqual({ tipo: "RECEBIMENTO", forma: "CARTAO" });
    expect(tipo(m("subacquirer", "subacquirerDebitTax", -4.2))).toEqual({ tipo: "TAXA", forma: "CARTAO" });
    expect(tipo(m("subacquirer", "subacquirerDebitTaxAntecipation", -1.9))).toEqual({ tipo: "ANTECIPACAO", forma: "CARTAO" });
    expect(tipo(m("subacquirer", "subacquirerReversal", -129.9))).toEqual({ tipo: "ESTORNO", forma: "CARTAO" });
  });
  it("boleto pago por Pix ou no banco, e as taxas", () => {
    expect(tipo(m("boleto", "creditPix", 119))).toEqual({ tipo: "RECEBIMENTO", forma: "PIX" });
    expect(tipo(m("boleto", "credit", 119))).toEqual({ tipo: "RECEBIMENTO", forma: "BOLETO" });
    expect(tipo(m("boleto", "debitTaxPix", -2.99)).tipo).toBe("TAXA");
    expect(tipo(m("boleto", "debitTax", -2.99)).tipo).toBe("TAXA");
  });
  it("tarifas do gateway (WhatsApp, modulos)", () => {
    expect(tipo(m("notificationWhatsapp", "debitTax", -0.49)).tipo).toBe("TARIFA");
    expect(tipo(m("mensality", "debitNotificationWhatsApp", -99)).tipo).toBe("TARIFA");
    expect(tipo(m("purchaseModule", "debit", -299)).tipo).toBe("TARIFA");
  });
  it("Pix enviado: conta da empresa e transferencia; terceiro e pagamento; tarifa do Pix e taxa", () => {
    expect(tipo(m("paymentPix", "debitGrossValueEnabled", -10000, "PIX enviado para: Black Barber Ltda"))).toEqual({ tipo: "TRANSFERENCIA", forma: "PIX" });
    expect(tipo(m("paymentPix", "debitGrossValueEnabled", -5000, "PIX enviado para: BLACK BARBEARIA LTDA")).tipo).toBe("TRANSFERENCIA");
    expect(tipo(m("paymentPix", "debitGrossValueEnabled", -5000, "PIX enviado para: Fauli David Gonzalez Solorzano"))).toEqual({ tipo: "PAGAMENTO", forma: "PIX" });
    expect(tipo(m("paymentPix", "debitTaxEnabled", -0.99, "Tarifa PIX enviado")).tipo).toBe("TAXA");
    expect(tipo(m("returnPix", "credit", 3044.82, "PIX recebido de: Black Barber")).tipo).toBe("TRANSFERENCIA");
    expect(tipo(m("returnTransactionPix", "credit", 10, "Pix recebido - Transação #9"))).toEqual({ tipo: "RECEBIMENTO", forma: "PIX" });
  });
  it("nome do Pix e conta propria sem acento nem caixa", () => {
    expect(contraparte("PIX enviado para: Fulano de Tal")).toBe("Fulano de Tal");
    expect(contraparte("Tarifa PIX enviado")).toBeNull();
    expect(ehContaPropria("Black Bárber Ltda", PROPRIAS)).toBe(true);
    expect(ehContaPropria("Barbearia Bonfort Ltda", PROPRIAS)).toBe(false);
    expect(ehContaPropria(null, PROPRIAS)).toBe(false);
  });
});

describe("resumo do extrato no mes", () => {
  it("separa recebido, custos, estornos, transferencias e pagamentos", () => {
    const r = resumirExtrato([
      { tipo: "RECEBIMENTO", forma: "CARTAO", valorCentavos: 10_000, categoria: null },
      { tipo: "RECEBIMENTO", forma: "PIX", valorCentavos: 5_000, categoria: null },
      { tipo: "TAXA", forma: "CARTAO", valorCentavos: -400, categoria: null },
      { tipo: "ANTECIPACAO", forma: "CARTAO", valorCentavos: -150, categoria: null },
      { tipo: "TARIFA", forma: null, valorCentavos: -50, categoria: null },
      { tipo: "ESTORNO", forma: "CARTAO", valorCentavos: -1_000, categoria: null },
      { tipo: "TRANSFERENCIA", forma: "PIX", valorCentavos: -8_000, categoria: null },
      { tipo: "PAGAMENTO", forma: "PIX", valorCentavos: -2_000, categoria: "FOLHA" },
      { tipo: "PAGAMENTO", forma: "PIX", valorCentavos: -300, categoria: null },
    ]);
    expect(r.recebido).toBe(15_000);
    expect(r.recebidoPorForma).toEqual({ CARTAO: 10_000, PIX: 5_000 });
    expect(r.custoGateway).toBe(600);
    expect(r.estornos).toBe(1_000);
    expect(r.liquido).toBe(15_000 - 600 - 1_000);
    expect(r.transferidoParaEmpresa).toBe(8_000);
    expect(r.pagamentos).toBe(2_300);
    expect(r.pagamentosSemCategoria).toBe(300);
  });
  it("divergencia so acima de R$ 1 e de 1%", () => {
    expect(divergente(100_000, 100_050)).toBe(false);
    expect(divergente(100_000, 102_000)).toBe(true);
    expect(divergente(5_000, 5_080)).toBe(false);
    expect(divergente(5_000, 5_200)).toBe(true);
  });
});
