import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { asaas } from "@/lib/pagamentos/asaas";
import { exigirEmissaoDeCobranca, exigirEmissaoDeCobrancaPorId } from "@/lib/pagamentos/bloqueio-cobranca";
import { celcash } from "@/lib/pagamentos/celcash";
import { modoCartaoCheckout } from "@/lib/pagamentos/checkout";
import { _usarFetch, criarPedidoMaquininha, pagarme } from "@/lib/pagamentos/pagarme";

const cliente = { nome: "Teste", cpf: "52998224725", telefone: "5511999990000", email: "teste@example.invalid", referencia: "fixture" };
const nova = {
  clienteGatewayId: "cus_fixture", valorCentavos: 1000, forma: "PIX" as const, descricao: "Teste",
  referencia: "fixture", primeiroVencimento: "2026-11-11", vencimento: "2026-11-11", validadeHoras: 1,
};
const transporte = vi.fn<typeof fetch>();
const bloqueio = { status: 503, codigo: "cobrancas_reais_bloqueadas" };

beforeEach(() => {
  transporte.mockReset();
  vi.stubEnv("AMBIENTE", "local");
  vi.stubEnv("PAGAMENTOS_PROVIDER", "pagarme");
  vi.stubEnv("PAGAMENTOS_COBRANCAS_REAIS_BLOQUEADAS", "true");
  vi.stubEnv("PAGARME_SECRET_KEY", "ficticia");
  vi.stubEnv("ASAAS_API_KEY", "ficticia");
  vi.stubEnv("CELCASH_GALAX_ID", "ficticio");
  vi.stubEnv("CELCASH_GALAX_HASH", "ficticio");
  vi.stubGlobal("fetch", transporte);
  _usarFetch(transporte);
});
afterEach(() => {
  vi.unstubAllEnvs(); vi.unstubAllGlobals();
  _usarFetch((...a) => fetch(...a));
});

it("barra cliente novo, contrato, Pix, pedido POS e troca de cartão antes do transporte", async () => {
  for (const g of [pagarme, celcash, asaas]) {
    await expect(g.criarCliente(cliente)).rejects.toMatchObject(bloqueio);
    await expect(g.criarAssinatura(nova)).rejects.toMatchObject(bloqueio);
  }
  await expect(pagarme.criarCobrancaPix!(nova)).rejects.toMatchObject(bloqueio);
  await expect(pagarme.criarCobrancaAvulsa!(nova)).rejects.toMatchObject(bloqueio);
  await expect(celcash.criarCobrancaAvulsa!(nova)).rejects.toMatchObject(bloqueio);
  await expect(pagarme.atualizarCartao!("sub_fixture", "token_fixture")).rejects.toMatchObject(bloqueio);
  await expect(criarPedidoMaquininha({ referencia: "fixture", valorCentavos: 1000, descricao: "Teste", tipo: "debit", serial: "fixture", cliente }))
    .rejects.toMatchObject(bloqueio);
  expect(transporte).not.toHaveBeenCalled();
});

it("mantém consulta dos três provedores, inclusive a autenticação necessária à leitura da Celcash", async () => {
  transporte.mockImplementation(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/token") && init?.method === "POST") return Response.json({ access_token: "fixture" });
    expect(init?.method).toBe("GET");
    if (path.includes("/v2/transactions")) return Response.json({ Transactions: [{ galaxPayId: 1, status: "pendingPix", value: 1000, payday: "2026-11-11" }] });
    if (path.includes("/v3/payments")) return Response.json({ id: "pay_fixture", status: "PENDING", value: 10, dueDate: "2026-11-11" });
    return Response.json({ id: "ch_fixture", status: "pending", amount: 1000, due_at: "2026-11-11", payment_method: "pix" });
  });
  await expect(pagarme.buscarCobranca("ch_fixture")).resolves.toMatchObject({ id: "ch_fixture" });
  await expect(celcash.buscarCobranca("celtx_1")).resolves.toMatchObject({ id: "celtx_1" });
  await expect(asaas.buscarCobranca("pay_fixture")).resolves.toMatchObject({ id: "pay_fixture" });
  expect(transporte).toHaveBeenCalledTimes(4);
});

it("mantém simulação e usa o provedor original quando já existe uma cobrança", () => {
  expect(() => exigirEmissaoDeCobranca()).toThrow();
  expect(() => exigirEmissaoDeCobranca("simulado")).not.toThrow();
  expect(() => exigirEmissaoDeCobrancaPorId("simsub_fixture")).not.toThrow();
  vi.stubEnv("PAGAMENTOS_PROVIDER", "simulado");
  expect(() => exigirEmissaoDeCobrancaPorId("pixrec_fixture")).toThrow();
  expect(modoCartaoCheckout("pagarme")).toBe("indisponivel");
});
