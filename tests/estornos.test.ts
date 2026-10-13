import { describe, expect, it } from "vitest";
import { foiRecebido, resumoComanda } from "@/lib/comandas/regras";
import {
  aceitaParcial, erroNoPedido, formaFinanceira, instrucaoManual, limiteEstorno, meioDoEstorno, somarPorForma, statusDoRetorno, textoAvisoDono,
} from "@/lib/estornos/regras";
import { montarExtrato } from "@/lib/financeiro/regras";

const item = (q: number, p: number) => ({ quantidade: q, precoUnitCentavos: p });

describe("meio do estorno", () => {
  it("comanda: dinheiro, maquininha, simulada ou por fora", () => {
    expect(meioDoEstorno({ tipo: "COMANDA", gatewayId: null, forma: "DINHEIRO" })).toBe("DINHEIRO");
    expect(meioDoEstorno({ tipo: "COMANDA", gatewayId: "or_abc", forma: "CREDITO" })).toBe("MAQUININHA");
    expect(meioDoEstorno({ tipo: "COMANDA", gatewayId: "sim_abc", forma: "PIX" })).toBe("SIMULADO");
    expect(meioDoEstorno({ tipo: "COMANDA", gatewayId: null, forma: "DEBITO" })).toBe("FORA");
  });
  it("online: pelo prefixo do gateway", () => {
    expect(meioDoEstorno({ tipo: "LINK", gatewayId: "or_1" })).toBe("PAGARME");
    expect(meioDoEstorno({ tipo: "MENSALIDADE", gatewayId: "ch_1" })).toBe("PAGARME");
    expect(meioDoEstorno({ tipo: "MENSALIDADE", gatewayId: "celtx_9" })).toBe("CELCASH");
    expect(meioDoEstorno({ tipo: "ANTECIPADO", gatewayId: "celchg_9" })).toBe("CELCASH");
    expect(meioDoEstorno({ tipo: "ANTECIPADO", gatewayId: "simpix_1" })).toBe("SIMULADO");
    expect(meioDoEstorno({ tipo: "MENSALIDADE", gatewayId: "pay_1" })).toBe("ASAAS");
  });
  it("parcial so onde o meio aceita; mensalidade so total", () => {
    expect(aceitaParcial("PAGARME", "LINK")).toBe(true);
    expect(aceitaParcial("DINHEIRO", "COMANDA")).toBe(true);
    expect(aceitaParcial("CELCASH", "ANTECIPADO")).toBe(false);
    expect(aceitaParcial("FORA", "COMANDA")).toBe(false);
    expect(aceitaParcial("PAGARME", "MENSALIDADE")).toBe(false);
  });
  it("forma no financeiro", () => {
    expect(formaFinanceira("COMANDA", "CREDITO")).toBe("CREDITO");
    expect(formaFinanceira("LINK", "PIX")).toBe("ONLINE");
  });
});

describe("limite e validacao do pedido", () => {
  it("desconta o que ja foi pedido e respeita o liquido da comanda (troco)", () => {
    expect(limiteEstorno({ valorCentavos: 5000, jaPedido: 0 })).toBe(5000);
    expect(limiteEstorno({ valorCentavos: 5000, jaPedido: 1000 })).toBe(4000);
    expect(limiteEstorno({ valorCentavos: 5000, jaPedido: 6000 })).toBe(0);
    expect(limiteEstorno({ valorCentavos: 5000, jaPedido: 0, liquidoComanda: 4321 })).toBe(4321);
  });
  it("motivo obrigatorio, valor dentro do limite e total quando o meio exige", () => {
    const base = { valorCentavos: 1000, limite: 5000, motivo: "cobrado duas vezes", parcialPermitido: true, valorOriginal: 5000 };
    expect(erroNoPedido(base)).toBeNull();
    expect(erroNoPedido({ ...base, motivo: " " })).toMatch(/motivo/);
    expect(erroNoPedido({ ...base, valorCentavos: 0 })).toMatch(/maior que zero/);
    expect(erroNoPedido({ ...base, valorCentavos: 6000 })).toMatch(/máximo/);
    expect(erroNoPedido({ ...base, limite: 0 })).toMatch(/já foi estornado/);
    expect(erroNoPedido({ ...base, parcialPermitido: false })).toMatch(/total/);
    expect(erroNoPedido({ ...base, parcialPermitido: false, valorCentavos: 5000 })).toBeNull();
  });
});

describe("retorno, instrucoes e aviso", () => {
  it("Pix em processamento conta como executado, com observacao", () => {
    expect(statusDoRetorno({ pendente: false })).toEqual({ status: "EXECUTADO", instrucao: null });
    expect(statusDoRetorno({ pendente: true }).instrucao).toMatch(/processamento/);
  });
  it("instrucao do estorno por fora diz onde fazer", () => {
    expect(instrucaoManual("CELCASH", 7000)).toMatch(/painel da Celcash/);
    expect(instrucaoManual("MAQUININHA", 7000)).toMatch(/própria maquininha/);
  });
  it("aviso ao dono leva valor, motivo e o link do painel", () => {
    const t = textoAvisoDono({ pedidoPor: "Ana", descricao: "Comanda #3 · Pix", valorCentavos: 4500, motivo: "duplicado", link: "http://painel/financeiro?aba=estornos" });
    expect(t).toContain("Ana");
    expect(t).toMatch(/45,00/);
    expect(t).toContain("duplicado");
    expect(t).toContain("http://painel/financeiro?aba=estornos");
  });
  it("soma por forma", () => {
    expect(somarPorForma([{ forma: "PIX", valorCentavos: 100 }, { forma: "PIX", valorCentavos: 50 }, { forma: "ONLINE", valorCentavos: 10 }])).toEqual({ PIX: 150, ONLINE: 10 });
  });
});

describe("comanda com estorno", () => {
  it("estornado total continua como recebido (historico) e sai do pago liquido", () => {
    const pgs = [{ forma: "PIX" as const, valorCentavos: 5000, status: "CANCELADO" as const, estornadoCentavos: 5000, estornadoEm: new Date() }];
    const r = resumoComanda([item(1, 5000)], pgs);
    expect(r.pago).toBe(0);
    expect(r.estornado).toBe(5000);
    expect(r.falta).toBe(5000);
    expect(foiRecebido(pgs[0])).toBe(true);
  });
  it("desfeito sem estorno nao conta; troco calculado no bruto", () => {
    expect(foiRecebido({ status: "CANCELADO", estornadoEm: null })).toBe(false);
    const r = resumoComanda([item(1, 4321)], [{ forma: "DINHEIRO", valorCentavos: 5000, status: "PAGO", estornadoCentavos: 1000, estornadoEm: new Date() }]);
    expect(r.troco).toBe(679);
    expect(r.pago).toBe(4000);
    expect(r.estornado).toBe(1000);
  });
  it("extrato: estorno e saida; so o de dinheiro mexe na gaveta", () => {
    const em = new Date();
    const l = montarExtrato([
      { tipo: "ABERTURA", em, descricao: "a", valorCentavos: 10000, dinheiro: true },
      { tipo: "ESTORNO", em, descricao: "pix", valorCentavos: 3000, dinheiro: false },
      { tipo: "ESTORNO", em, descricao: "dinheiro", valorCentavos: 2000, dinheiro: true },
    ]);
    expect(l.every((x) => x.tipo === "ABERTURA" || !x.entrada)).toBe(true);
    expect(l.at(-1)!.saldoCentavos).toBe(8000);
  });
});
