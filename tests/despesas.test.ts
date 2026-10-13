import { describe, expect, it } from "vitest";
import {
  diasDoMes, mesAnterior, montarExtrato, proximoVencimento, serieDiaria, situacaoDespesa, totaisDespesas, variacao, type EventoExtrato,
} from "@/lib/financeiro/regras";

describe("despesas", () => {
  it("proximo vencimento da recorrente: mesmo dia no mes seguinte", () => {
    expect(proximoVencimento("2026-10-05")).toBe("2026-11-05");
    expect(proximoVencimento("2026-12-10")).toBe("2027-01-10");
  });
  it("proximo vencimento: dia 31 vira o ultimo dia do mes", () => {
    expect(proximoVencimento("2026-01-31")).toBe("2026-02-28");
    expect(proximoVencimento("2028-01-30")).toBe("2028-02-29");
    expect(proximoVencimento("2026-03-31")).toBe("2026-04-30");
  });
  it("situacao: vencida so quando pendente e antes de hoje", () => {
    expect(situacaoDespesa({ status: "PENDENTE", vencimento: "2026-10-05" }, "2026-10-06")).toBe("VENCIDA");
    expect(situacaoDespesa({ status: "PENDENTE", vencimento: "2026-10-06" }, "2026-10-06")).toBe("ABERTA");
    expect(situacaoDespesa({ status: "PAGA", vencimento: "2026-09-01" }, "2026-10-06")).toBe("PAGA");
  });
  it("totais: a pagar, vencidas, pagas no mes e por categoria", () => {
    const t = totaisDespesas([
      { categoria: "ALUGUEL", valorCentavos: 300000, status: "PENDENTE", vencimento: "2026-10-01", pagoEm: null },
      { categoria: "ENERGIA", valorCentavos: 45000, status: "PENDENTE", vencimento: "2026-10-20", pagoEm: null },
      { categoria: "ENERGIA", valorCentavos: 40000, status: "PAGA", vencimento: "2026-09-20", pagoEm: "2026-10-02" },
      { categoria: "BAR", valorCentavos: 12000, status: "PAGA", vencimento: "2026-09-10", pagoEm: "2026-09-12" },
    ], "2026-10-06", "2026-10");
    expect(t.aPagar).toBe(345000);
    expect(t.vencidas).toBe(300000);
    expect(t.qtdVencidas).toBe(1);
    expect(t.pagasNoMes).toBe(40000);
    expect(t.porCategoria).toEqual({ ALUGUEL: { aberto: 300000, pago: 0 }, ENERGIA: { aberto: 45000, pago: 40000 }, BAR: { aberto: 0, pago: 0 } });
  });
});

describe("extrato do caixa", () => {
  const h = (min: number) => new Date(Date.UTC(2026, 9, 6, 12, min));
  it("ordena por horario e calcula o saldo da gaveta so com dinheiro", () => {
    const ev: EventoExtrato[] = [
      { tipo: "FECHAMENTO", em: h(50), descricao: "fecha", valorCentavos: 16000, dinheiro: false, contado: 16000, esperado: 16321, diferenca: -321 },
      { tipo: "TROCO", em: h(10), descricao: "troco", valorCentavos: 679, dinheiro: true },
      { tipo: "PAGAMENTO", em: h(10), descricao: "#1", valorCentavos: 5000, dinheiro: true, forma: "DINHEIRO" },
      { tipo: "PAGAMENTO", em: h(20), descricao: "#2", valorCentavos: 6500, dinheiro: false, forma: "PIX" },
      { tipo: "SUPRIMENTO", em: h(30), descricao: "reforco", valorCentavos: 2000, dinheiro: true },
      { tipo: "DESPESA", em: h(40), descricao: "Despesa: agua", valorCentavos: 5000, dinheiro: true },
      { tipo: "ABERTURA", em: h(0), descricao: "abre", valorCentavos: 15000, dinheiro: true },
    ];
    const l = montarExtrato(ev);
    expect(l.map((x) => x.tipo)).toEqual(["ABERTURA", "PAGAMENTO", "TROCO", "PAGAMENTO", "SUPRIMENTO", "DESPESA", "FECHAMENTO"]);
    expect(l.map((x) => x.saldoCentavos)).toEqual([15000, 20000, 19321, 19321, 21321, 16321, 16321]);
    expect(l[3].efeitoCentavos).toBe(0);
    expect(l[5].entrada).toBe(false);
    expect(l[6].efeitoCentavos).toBe(0);
  });
  it("abertura e fechamento ficam nas pontas mesmo com o mesmo horario", () => {
    const l = montarExtrato([
      { tipo: "PAGAMENTO", em: h(0), descricao: "#1", valorCentavos: 100, dinheiro: true },
      { tipo: "FECHAMENTO", em: h(0), descricao: "f", valorCentavos: 0, dinheiro: false },
      { tipo: "ABERTURA", em: h(0), descricao: "a", valorCentavos: 0, dinheiro: true },
    ]);
    expect(l.map((x) => x.tipo)).toEqual(["ABERTURA", "PAGAMENTO", "FECHAMENTO"]);
  });
});

describe("resumo do mes", () => {
  it("mes anterior e dias do mes", () => {
    expect(mesAnterior("2026-01")).toBe("2025-12");
    expect(mesAnterior("2026-10")).toBe("2026-09");
    expect(diasDoMes("2026-02")).toHaveLength(28);
    expect(diasDoMes("2026-10").at(-1)).toBe("2026-10-31");
  });
  it("serie diaria soma por dia e ignora fora do mes", () => {
    const s = serieDiaria("2026-10", [{ data: "2026-10-01", valor: 100 }, { data: "2026-10-01", valor: 50 }, { data: "2026-11-01", valor: 999 }], [{ data: "2026-10-02", valor: 30 }]);
    expect(s).toHaveLength(31);
    expect(s[0]).toEqual({ dia: "2026-10-01", receita: 150, despesa: 0 });
    expect(s[1]).toEqual({ dia: "2026-10-02", receita: 0, despesa: 30 });
  });
  it("variacao percentual", () => {
    expect(variacao(150, 100)).toBe(50);
    expect(variacao(50, 100)).toBe(-50);
    expect(variacao(10, 0)).toBeNull();
    expect(variacao(-50, -100)).toBe(50);
  });
});
