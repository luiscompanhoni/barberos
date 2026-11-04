import { afterEach, expect, it, vi } from "vitest";
import { _usarFetch, pagarme } from "@/lib/pagamentos/pagarme";

afterEach(() => vi.unstubAllEnvs());
it.each([
  ["lk-link1-tentativa123", "lk-link1-tentativa123"],
  ["antecipado-atendimento1", null],
])("idempotência usa intenção da tentativa do link sem alterar checkout legado: %s", async (referencia, esperada) => {
  vi.stubEnv("PAGARME_SECRET_KEY", "sk_test_sintetica");
  const chamadas: RequestInit[] = [];
  _usarFetch((async (_url, init) => {
    chamadas.push(init!);
    return new Response(JSON.stringify({ id: "or_sintetico", status: "pending", charges: [] }));
  }) as typeof fetch);
  await pagarme.criarCobrancaAvulsa!({
    clienteGatewayId: "cus_sintetico", valorCentavos: 5000, forma: "PIX", vencimento: "2026-11-03",
    descricao: "Comanda sintética", referencia: referencia!, pixValidadeSeg: 3600,
  });
  expect(chamadas).toHaveLength(1);
  expect(new Headers(chamadas[0].headers).get("Idempotency-key")).toBe(esperada);
});
