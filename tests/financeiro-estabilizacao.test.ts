import { describe, expect, it } from "vitest";
import { converter as celcash } from "@/lib/pagamentos/celcash";
import { converterCobranca as pagarme } from "@/lib/pagamentos/pagarme";
import { converter as asaas } from "@/lib/pagamentos/asaas";
import { dadosRecebimento, instanteRecebimento } from "@/lib/pagamentos/recebimento";
import { basesRecebidasComanda } from "@/lib/rh/base-produtos";
import { csvFolha } from "@/lib/rh/regras";
import { revisaoApuracao } from "@/lib/rh/revisao";
import { lerMemoriaFolha } from "@/lib/rh/memoria-folha";

describe("contrato financeiro comprovado", () => {
  const t = { galaxPayId: 99, value: 10000, payday: "2026-10-01", paydayDate: "2026-10-01", paydayDateDateTime: "2026-11-02 10:30:00", status: "payedPix" };
  it("Celcash separa vencimento e pagamento efetivo, sem usar data de status", () => {
    const c = celcash(t, null);
    expect(c.valorCentavos).toBe(10000);
    expect(c.pagaEm).toBe("2026-11-02T13:30:00.000Z");
    expect(c.recebimento?.valorCentavos).toBe(10000);
    expect(celcash({ ...t, paydayDateDateTime: null }, null).recebimento).toBeUndefined();
    expect(celcash({ ...t, paydayDateDateTime: null }, null).pagaEm).toBeNull();
    expect(celcash({ ...t, paydayDateDateTime: "2026-11-02" }, null).recebimento).toBeUndefined();
  });
  it.each(["free", "payExternal", "lessValueBoleto", "moreValueBoleto", "paidDuplicityBoleto"])("não inventa recebido a partir do substatus %s", status => {
    const c = celcash({ ...t, status }, null);
    expect(c.status).toBe("PAGA");
    expect(c.recebimento).toBeUndefined();
    expect(c.pendenciaRecebimento).toBeTruthy();
  });
  it("a marca fora do gateway exige conciliação mesmo com substatus normal", () => {
    expect(celcash({ ...t, payedOutsideGalaxPay: true }, null).recebimento).toBeUndefined();
  });
  it("Pagar.me mantém nominal e bruto pago diferentes, sem subtrair devolução duas vezes", () => {
    const c = pagarme({ id: "ch_ficticia", amount: 10000, paid_amount: 9000, canceled_amount: 2000, status: "paid", paid_at: "2026-11-02T13:30:00Z" });
    expect(c.valorCentavos).toBe(10000); expect(c.recebimento?.valorCentavos).toBe(9000);
    expect(pagarme({ id: "ch_sem_prova", amount: 10000, status: "paid" }).recebimento).toBeUndefined();
    expect(pagarme({ id: "ch_sem_hora", amount: 10000, paid_amount: 10000, paid_at: "2026-11-02", status: "paid" }).recebimento).toBeUndefined();
  });
  it("Asaas usa pagamento efetivo e mantém recebimento em dinheiro separado", () => {
    const c = asaas({ id: "pay_ficticia", value: 90, originalValue: 100, dueDate: "2026-10-01", status: "CONFIRMED", paymentDate: "2026-11-02", confirmedDate: "2026-11-03" });
    expect(c.valorCentavos).toBe(10000); expect(c.recebimento?.valorCentavos).toBe(9000);
    expect(c.recebimento?.em).toContain("2026-11-02");
    expect(c.recebimento?.precisaoData).toBe("DIA");
    expect(asaas({ id: "pay_fora", value: 100, dueDate: "2026-11-01", status: "RECEIVED_IN_CASH", paymentDate: "2026-11-02" }).recebimento).toBeUndefined();
  });
  it("recusa datas impossíveis e provas atribuídas a outra cobrança", () => {
    expect(instanteRecebimento("2026-02-31")).toBeNull(); expect(instanteRecebimento("hoje")).toBeNull();
    const c = celcash(t, null); expect(dadosRecebimento({ ...c, id: "outra" })).toEqual({});
    expect(dadosRecebimento({ ...c, recebimento: { ...c.recebimento!, valorCentavos: -1 } })).toEqual({});
  });
});

describe("base de produtos e memória histórica", () => {
  const itens = [{ id: "a", quantidade: 1, precoUnitCentavos: 1000 }, { id: "b", quantidade: 1, precoUnitCentavos: 2000 }];
  it("rateia desconto, estorno e troco sem comissão sobre dinheiro devolvido", () => {
    const bases = basesRecebidasComanda({ itens, descontoCentavos: 300, pagamentos: [{ forma: "DINHEIRO", status: "PAGO", valorCentavos: 3000, estornadoCentavos: 600, estornadoEm: new Date() }] });
    expect([...bases.values()].reduce((s, x) => s + x, 0)).toBe(2100);
    expect(bases.get("a")).toBe(700); expect(bases.get("b")).toBe(1400);
  });
  it("preserva um centavo de resíduo de forma estável entre itens", () => {
    const c = { itens: itens.map(i => ({ ...i, precoUnitCentavos: 1 })), descontoCentavos: 1, pagamentos: [{ forma: "PIX" as const, status: "PAGO" as const, valorCentavos: 1 }] };
    expect([...basesRecebidasComanda(c)]).toEqual([["a", 1], ["b", 0]]);
    expect([...basesRecebidasComanda({ ...c, itens: [...c.itens].reverse() })]).toEqual([["a", 1], ["b", 0]]);
  });
  it("ordem de consulta não muda revisão; alteração real de prova ou vínculo muda", () => {
    expect(revisaoApuracao([{ id: "a", valor: 1 }, { id: "b", valor: 2 }])).toBe(revisaoApuracao([{ valor: 2, id: "b" }, { valor: 1, id: "a" }]));
    expect(revisaoApuracao({ vinculo: "a" })).not.toBe(revisaoApuracao({ vinculo: "b" }));
  });
  it("não fabrica memória para folha antiga", () => expect(lerMemoriaFolha({})).toBeNull());
  it.each(["=1+1", "+HYPERLINK(1)", "-1+1", "@SUM(1)", "\t=1+1", "\r=1+1"])("neutraliza fórmula textual CSV %s", nome => {
    const csv = csvFolha("2026-11", [{ nome, cargo: null, salario: 0, comissao: 0, adicionais: 0, descontos: 100, liquido: -100, status: "Prévia", chavePix: null }]);
    expect(csv).toContain(`'${nome}`); expect(csv).toContain("-1,00");
  });
});
