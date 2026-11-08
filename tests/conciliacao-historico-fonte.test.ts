import { afterEach, describe, expect, it, vi } from "vitest";
import { buscarTransacaoHistorica, lerTransacaoHistorica } from "@/lib/conciliacao/historico/fonte";
const transacao = { galaxPayId: 91001, value: 11800, payday: "2026-10-23", status: "captured", Subscription: { galaxPayId: 101, Customer: { name: "Pessoa Sintética", document: "", phones: [11999990001] } } };
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("detalhe da Celcash somente leitura", () => {
  it("normaliza e retém apenas os campos de conciliação", () => {
    const r = lerTransacaoHistorica({ Transactions: [{ ...transacao, Card: { secret: "nao-preservar" } }] }, "91001");
    expect(r.id).toBe("91001"); expect(r.contratoId).toBe("101"); expect(r.cliente.telefones).toEqual(["11999990001"]);
    expect(JSON.stringify(r)).not.toContain("nao-preservar");
  });
  it.each([{ Transactions: [] }, { Transactions: [transacao, transacao] }, { Transactions: [{ ...transacao, value: "11800" }] }, { Transactions: [{ ...transacao, payday: "2026-02-30" }] }])("falha fechada em resposta inconsistente", (j) => { expect(() => lerTransacaoHistorica(j, "91001")).toThrow(); });
  it("consulta só o ID exato com escopo transactions.read e nunca aciona pagamento", async () => {
    vi.stubEnv("CELCASH_GALAX_ID", "sintetico"); vi.stubEnv("CELCASH_GALAX_HASH", "sintetico"); vi.stubEnv("CELCASH_AMBIENTE", "sandbox");
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ access_token: "token-sintetico" })).mockResolvedValueOnce(Response.json({ Transactions: [transacao] })); vi.stubGlobal("fetch", fetch);
    expect((await buscarTransacaoHistorica("91001")).valorCentavos).toBe(11800);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[0][1].body).scope).toBe("transactions.read");
    expect(fetch.mock.calls[1][0]).toBe("https://api.sandbox.cel.cash/v2/transactions?galaxPayIds=91001&startAt=0&limit=1");
    expect(fetch.mock.calls[1][1].method).toBeUndefined();
  });
  it("recusa contratos conflitantes e não usa cliente avulso como titular de assinatura", () => {
    expect(() => lerTransacaoHistorica({ Transactions: [{ ...transacao, subscriptionGalaxPayId: 999 }] }, "91001")).toThrow("conflitantes");
    const r = lerTransacaoHistorica({ Transactions: [{ ...transacao, Subscription: null, Charge: { Customer: transacao.Subscription.Customer } }] }, "91001");
    expect(r.contratoId).toBeNull(); expect(r.cliente.nome).toBe("");
  });
  it("não tenta consulta sem credenciais nem aceita outro ID", async () => {
    vi.stubEnv("CELCASH_GALAX_ID", ""); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(buscarTransacaoHistorica("91001")).rejects.toThrow("não está configurada"); expect(fetch).not.toHaveBeenCalled();
    expect(() => lerTransacaoHistorica({ Transactions: [transacao] }, "91002")).toThrow();
  });
  it("retém data efetiva e marca externa sem inferir data de crédito, status ou vencimento", () => {
    const r = lerTransacaoHistorica({ Transactions: [{ ...transacao, paydayDateDateTime: "2026-10-22 10:30:00", payedOutsideGalaxPay: true }] }, "91001");
    expect(r.pagamentoEfetivoEm).toBe("2026-10-22T13:30:00.000Z"); expect(r.pagoForaDoGateway).toBe(true);
    const semData = lerTransacaoHistorica({ Transactions: [{ ...transacao, statusDate: "2026-10-23", paydayDateDateTime: "2026-02-31" }] }, "91001");
    expect(semData.pagamentoEfetivoEm).toBeNull();
  });
});
