import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _usarFetch, aplicarCreditoFixo, aplicarDesconto, consultarParaCredito } from "@/lib/pagamentos/retencao-gateway";

const transporte = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("CREDITOS_MENSALIDADE_ATIVOS", "true"); vi.stubEnv("AMBIENTE", "desenvolvimento");
  vi.stubEnv("PAGAMENTOS_PROVIDER", "pagarme"); vi.stubEnv("PAGARME_SECRET_KEY", "chave_ficticia_teste");
  _usarFetch(transporte); transporte.mockResolvedValue(new Response(JSON.stringify({ id: "dis_1" }), { status: 200 }));
});
afterEach(() => { vi.unstubAllEnvs(); _usarFetch((...args) => fetch(...args)); });

describe("transporte reaproveitado sem API real", () => {
  it("desconto usa centavos, flat, um ciclo e chave persistida de idempotência", async () => {
    await aplicarCreditoFixo("sub_1", 2000, "reserva-1");
    const [url, opcoes] = transporte.mock.calls[0];
    expect(url).toBe("https://api.pagar.me/core/v5/subscriptions/sub_1/discounts");
    expect(opcoes?.method).toBe("POST"); expect(JSON.parse(opcoes!.body as string)).toEqual({ value: 2000, discount_type: "flat", cycles: 1 });
    expect(new Headers(opcoes!.headers).get("Idempotency-key")).toBe("reserva-1");
  });
  it("consulta GET não carrega body", async () => {
    await consultarParaCredito("/subscriptions/sub_1");
    expect(transporte.mock.calls[0][1]).toMatchObject({ method: "GET", body: undefined });
  });
  it.each(["flag", "homologacao"])("%s impede chamada real", async (caso) => {
    if (caso === "flag") vi.stubEnv("CREDITOS_MENSALIDADE_ATIVOS", "false"); else vi.stubEnv("AMBIENTE", "homologacao");
    await expect(aplicarCreditoFixo("sub_1", 2000, "reserva-1")).rejects.toThrow();
    await expect(consultarParaCredito("/subscriptions/sub_1")).rejects.toThrow();
    expect(transporte).not.toHaveBeenCalled();
  });
  it("retém comportamento do desconto percentual existente", async () => {
    await aplicarDesconto("sub_1", 20, 2);
    expect(JSON.parse(transporte.mock.calls[0][1]!.body as string)).toEqual({ value: 20, discount_type: "percentage", cycles: 2 });
  });
  it("timeout não é repetido pelo adapter", async () => {
    transporte.mockRejectedValue(new Error("timeout"));
    await expect(aplicarCreditoFixo("sub_1", 2000, "reserva-1")).rejects.toThrow("timeout");
    expect(transporte).toHaveBeenCalledTimes(1);
  });
});
