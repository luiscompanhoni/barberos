import { afterEach, describe, expect, it, vi } from "vitest";
import { conferirValoresPOS, ultimoInstantePOS } from "@/lib/comandas/maquininha-regras";
import { _usarFetch, criarPedidoMaquininha, type PedidoPOS } from "@/lib/pagamentos/pagarme";

const paga = { id: "ch1", status: "paid", amount: 1000, paid_amount: 1000, currency: "BRL" };
const pedido: PedidoPOS = { id: "or1", status: "pending", amount: 1000, currency: "BRL", charges: [paga] };
afterEach(() => { vi.unstubAllEnvs(); _usarFetch((...args) => fetch(...args)); });

describe("valores POS", () => {
  it("usa somente datas ISO válidas, sem normalizar dia impossível", () => {
    expect(ultimoInstantePOS([undefined, "ontem", "2026-02-30T12:00:00Z"])).toBeUndefined();
    expect(ultimoInstantePOS(["2026-11-01T12:00:00-03:00", "2026-11-01T16:00:00Z"]))
      .toEqual(new Date("2026-11-01T16:00:00Z"));
  });
  it("soma pagamentos parciais identificados para conferir o total", () => {
    expect(conferirValoresPOS({ ...pedido, charges: [
      { ...paga, id: "ch1", amount: 400, paid_amount: 400 },
      { ...paga, id: "ch2", amount: 600, paid_amount: 600 },
    ] }, 1000)).toMatchObject({ pago: true, recebido: 1000, estornado: 0 });
  });
  it.each([
    { currency: "USD" }, { paid_amount: -1 }, { paid_amount: 1001 },
    { paid_amount: 0.1 }, { canceled_amount: -1 }, { canceled_amount: 1001 }, { paid_amount: undefined, canceled_amount: 1 },
  ])("não comprova recebimento com charge inválida %j", (extra) => {
    expect(() => conferirValoresPOS({ ...pedido, charges: [{ ...paga, ...extra }] }, 1000)).toThrow();
  });
  it("não comprova pagamento quando paid_amount está ausente", () => {
    expect(conferirValoresPOS({ ...pedido, charges: [{ ...paga, paid_amount: undefined }] }, 1000).pago).toBe(false);
  });
  it("recusa charges duplicadas e soma recebida acima do pedido", () => {
    expect(() => conferirValoresPOS({ ...pedido, charges: [paga, paga] }, 1000)).toThrow(/repetidas/);
    expect(() => conferirValoresPOS({ ...pedido, charges: [paga, { ...paga, id: "ch2" }] }, 1000)).toThrow(/acima/);
  });
  it("refund não vira cancelamento sem registro de devolução do provedor", () => {
    expect(conferirValoresPOS({ ...pedido, status: "canceled", charges: [{ ...paga, status: "canceled" }] }, 1000))
      .toMatchObject({ pago: false, recebido: 1000, estornado: 0 });
  });
  it("só permite liberar reserva quando todas as cobranças terminaram com recebimento explicitamente zero", () => {
    expect(conferirValoresPOS({ ...pedido, charges: undefined }, 1000).cancelavel).toBe(false);
    expect(conferirValoresPOS({ ...pedido, charges: [] }, 1000).cancelavel).toBe(true);
    expect(conferirValoresPOS({ ...pedido, charges: [{ ...paga, status: "failed", paid_amount: 0 }] }, 1000).cancelavel).toBe(true);
    for (const ch of [
      { ...paga, status: "canceled", paid_amount: undefined },
      { ...paga, status: "processing", paid_amount: 0 },
      { ...paga, status: "paid", paid_amount: undefined },
    ]) expect(conferirValoresPOS({ ...pedido, charges: [ch] }, 1000).cancelavel).toBe(false);
  });
});

it("envia crédito/débito/Pix direto ao POS com Idempotency-key estável por pagamento", async () => {
  vi.stubEnv("PAGARME_SECRET_KEY", "sk_test_falsa");
  vi.stubEnv("STONE_POS_SERVICE_REFERER_NAME", "parceiro-ficticio");
  const split = [{ amount: 100, recipient_id: "rp_teste", type: "percentage",
    options: { liable: true, charge_processing_fee: true, charge_remainder_fee: true } }];
  vi.stubEnv("STONE_POS_SPLIT_JSON", JSON.stringify(split));
  const chamadas: RequestInit[] = [];
  _usarFetch((async (_url, init) => { chamadas.push(init!); return new Response(JSON.stringify({ id: "or_teste", status: "pending" })); }) as typeof fetch);
  for (const tipo of ["credit", "debit", "pix"] as const) {
    await criarPedidoMaquininha({ referencia: "cmd-42-pg1", valorCentavos: 1000, descricao: "Comanda #42", serial: "SERIAL1", tipo,
      cliente: { nome: "Teste", email: "teste@example.test" }, metadata: { pagamento_id: "pg1" } });
  }
  expect(chamadas).toHaveLength(3);
  for (const [i, init] of chamadas.entries()) {
    expect(new Headers(init.headers).get("Idempotency-key")).toBe("pos-pg1");
    expect(new Headers(init.headers).get("ServiceRefererName")).toBe("parceiro-ficticio");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(String(init.body));
    expect(body.poi_payment_settings.devices_serial_number).toEqual(["SERIAL1"]);
    expect(body.poi_payment_settings.payment_setup.type).toBe(["credit", "debit", "pix"][i]);
    expect(body.poi_payment_settings.payment_setup.split).toEqual(split);
  }
});

it("conta sem split: \"nenhum\" envia o pedido sem divisão; vazio continua bloqueando", async () => {
  vi.stubEnv("PAGARME_SECRET_KEY", "sk_test_falsa");
  vi.stubEnv("STONE_POS_SERVICE_REFERER_NAME", "parceiro-ficticio");
  const chamadas: RequestInit[] = [];
  _usarFetch((async (_url, init) => { chamadas.push(init!); return new Response(JSON.stringify({ id: "or_teste", status: "pending" })); }) as typeof fetch);
  const pedido = { referencia: "cmd-43-pg2", valorCentavos: 1000, descricao: "Comanda #43", serial: "SERIAL1", tipo: "credit" as const,
    cliente: { nome: "Teste", email: "teste@example.test" }, metadata: { pagamento_id: "pg2" } };
  vi.stubEnv("STONE_POS_SPLIT_JSON", " Nenhum ");
  await criarPedidoMaquininha(pedido);
  const setup = JSON.parse(String(chamadas[0].body)).poi_payment_settings.payment_setup;
  expect(setup).not.toHaveProperty("split");
  expect(setup).toMatchObject({ type: "credit", installments: 1, installment_type: "merchant" });
  for (const valor of ["", "[]", "nada"]) {
    vi.stubEnv("STONE_POS_SPLIT_JSON", valor);
    await expect(criarPedidoMaquininha(pedido)).rejects.toMatchObject({ codigo: "config" });
  }
  expect(chamadas).toHaveLength(1);
});
