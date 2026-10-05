import { describe, expect, it } from "vitest";
import { descricaoServico, erroNoPagamento, resumoComanda, saldoDepois } from "@/lib/comandas/regras";

const item = (q: number, p: number) => ({ quantidade: q, precoUnitCentavos: p });

describe("resumo da comanda", () => {
  it("soma itens e aplica desconto (sem passar do subtotal)", () => {
    const r = resumoComanda([item(1, 5000), item(2, 800)], [], 600);
    expect(r).toMatchObject({ subtotal: 6600, desconto: 600, total: 6000, pago: 0, falta: 6000, podeFechar: false });
    expect(resumoComanda([item(1, 1000)], [], 5000).total).toBe(0);
  });

  it("pagamento aguardando conta como reservado mas nao deixa fechar", () => {
    const r = resumoComanda([item(1, 5000)], [{ forma: "CREDITO", valorCentavos: 5000, status: "AGUARDANDO" }]);
    expect(r).toMatchObject({ pago: 0, aguardando: 5000, falta: 0, podeFechar: false });
  });

  it("dividido em duas formas fecha; cancelado nao conta", () => {
    const r = resumoComanda([item(1, 7000)], [
      { forma: "PIX", valorCentavos: 4000, status: "PAGO" },
      { forma: "DEBITO", valorCentavos: 3000, status: "PAGO" },
      { forma: "CREDITO", valorCentavos: 7000, status: "CANCELADO" },
    ]);
    expect(r).toMatchObject({ pago: 7000, falta: 0, troco: 0, podeFechar: true });
  });

  it("troco so do dinheiro", () => {
    const r = resumoComanda([item(1, 4500)], [{ forma: "DINHEIRO", valorCentavos: 5000, status: "PAGO" }]);
    expect(r).toMatchObject({ troco: 500, podeFechar: true });
  });

  it("comanda so com servico do plano (zero) pode fechar sem pagamento", () => {
    expect(resumoComanda([item(1, 0)], []).podeFechar).toBe(true);
  });
});

describe("validacao do pagamento", () => {
  it("cartao e Pix nao passam do que falta; dinheiro pode (troco)", () => {
    expect(erroNoPagamento("CREDITO", 6000, 5000)).toMatch(/maior/);
    expect(erroNoPagamento("DINHEIRO", 6000, 5000)).toBeNull();
    expect(erroNoPagamento("PIX", 5000, 5000)).toBeNull();
  });
  it("valor zero ou comanda ja paga", () => {
    expect(erroNoPagamento("PIX", 0, 5000)).toMatch(/maior que zero/);
    expect(erroNoPagamento("DINHEIRO", 100, 0)).toMatch(/já está paga/);
  });
});

describe("estoque", () => {
  it("avisa minimo e negativo", () => {
    expect(saldoDepois(5, -3, 2)).toEqual({ saldo: 2, baixo: true, negativo: false });
    expect(saldoDepois(1, -2, 0)).toEqual({ saldo: -1, baixo: true, negativo: true });
    expect(saldoDepois(1, 10, 2).baixo).toBe(false);
  });
  it("texto do servico", () => {
    expect(descricaoServico("Corte", "Pedro", true)).toBe("Corte com Pedro (plano)");
  });
});
