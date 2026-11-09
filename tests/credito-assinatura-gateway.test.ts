import type { Assinatura, Cobranca, ReservaCreditoAssinatura } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ consultar: vi.fn(), aplicar: vi.fn() }));
vi.mock("@/lib/pagamentos/retencao-gateway", () => ({ consultarParaCredito: mocks.consultar, aplicarCreditoFixo: mocks.aplicar }));
import { aplicarNoGateway, buscarProvaCobrancaCredito, conferirGatewayAntesDoCredito } from "@/lib/crescimento/credito-assinatura-gateway";
import { conferirSnapshotRemoto } from "@/lib/crescimento/credito-assinatura-regras";

const a = { id: "a", gatewayId: "sub_1", gatewayClienteId: "cus_1", precoCentavos: 11800, proximoVencimento: new Date("2026-12-15") } as Assinatura;
const r = { id: "reserva-1", assinaturaId: "a", valorCentavos: 2000, valorMensalidadeCentavos: 11800, vencimento: new Date("2026-12-15"), gatewayDescontoId: "dis_1" } as ReservaCreditoAssinatura;
const d = { id: "dis_1", value: 2000, discount_type: "flat", cycles: 1, status: "active" };
const snapshot = () => ({ id: "sub_1", customer: { id: "cus_1" }, status: "active", currency: "BRL", next_billing_at: "2026-12-15T12:00:00Z", interval: "month", interval_count: 1, billing_type: "prepaid", items: [{ quantity: 1, pricing_scheme: { scheme_type: "unit", price: 11800 } }], discounts: [] as unknown[], increments: [] });
const faturas = () => ({ data: [] as unknown[], paging: { total: 0, next: null } });

beforeEach(() => { vi.resetAllMocks(); });

describe("snapshot remoto antes do desconto", () => {
  it("aceita somente titular, moeda, preço, ciclo e ausência de fatura comprovados", () => {
    expect(conferirSnapshotRemoto(a, snapshot(), faturas())).toEqual({ vencimento: "2026-12-15", precoCentavos: 11800 });
  });
  it.each([
    { currency: "USD" }, { customer: { id: "cus_outro" } }, { next_billing_at: "2026-12-16T12:00Z" },
    { discounts: [d] }, { increments: [{ status: "active" }] }, { items: [] },
    { items: [{ quantity: 1, pricing_scheme: { scheme_type: "unit", price: 11799 } }] },
  ])("divergência %j bloqueia antes de reservar/aplicar", (extra) => {
    expect(() => conferirSnapshotRemoto(a, { ...snapshot(), ...extra }, faturas())).toThrow();
  });
  it("faturas incompletas ou já emitidas não autorizam desconto", () => {
    expect(() => conferirSnapshotRemoto(a, snapshot(), { data: [], paging: { total: 101, next: "/proxima" } })).toThrow();
    expect(() => conferirSnapshotRemoto(a, snapshot(), { data: [{ subscription_id: "sub_1", status: "pending", due_at: "2026-12-15" }], paging: { total: 1 } })).toThrow();
  });
  it("não inventa total nem campos omitidos", () => {
    expect(() => conferirSnapshotRemoto(a, snapshot(), { data: [] })).toThrow();
    expect(() => conferirSnapshotRemoto(a, { ...snapshot(), currency: undefined }, faturas())).toThrow();
  });
});

describe("desconto fixo de uma competência", () => {
  it("consulta antes, usa idempotência da reserva e exige GET posterior do desconto e assinatura", async () => {
    let aplicado = false;
    mocks.consultar.mockImplementation(async (path: string) => path.includes("/discounts/") ? d : path.startsWith("/invoices?") ? faturas() : { ...snapshot(), discounts: aplicado ? [d] : [] });
    mocks.aplicar.mockImplementation(async () => { aplicado = true; return d; });
    expect(await aplicarNoGateway(a, r)).toBe("dis_1");
    expect(mocks.aplicar).toHaveBeenCalledExactlyOnceWith("sub_1", 2000, "reserva-1");
    expect(mocks.consultar.mock.invocationCallOrder[0]).toBeLessThan(mocks.aplicar.mock.invocationCallOrder[0]);
    expect(mocks.consultar).toHaveBeenCalledWith("/subscriptions/sub_1/discounts/dis_1");
  });
  it("timeout não repete chamada externa", async () => {
    mocks.consultar.mockImplementation(async (path: string) => path.startsWith("/invoices?") ? faturas() : snapshot());
    mocks.aplicar.mockRejectedValue(new Error("timeout"));
    await expect(aplicarNoGateway(a, r)).rejects.toThrow("timeout");
    expect(mocks.aplicar).toHaveBeenCalledTimes(1);
  });
  it("POST sem prova posterior não confirma desconto", async () => {
    mocks.consultar.mockImplementation(async (path: string) => path.includes("/discounts/") ? { ...d, cycles: 2 } : path.startsWith("/invoices?") ? faturas() : snapshot());
    mocks.aplicar.mockResolvedValue(d);
    await expect(aplicarNoGateway(a, r)).rejects.toThrow();
  });
  it("campos ausentes impedem até a chamada de desconto", async () => {
    mocks.consultar.mockResolvedValue({});
    await expect(conferirGatewayAntesDoCredito(a)).rejects.toThrow();
    expect(mocks.aplicar).not.toHaveBeenCalled();
  });
});

describe("prova própria da cobrança", () => {
  const c = { id: "c", gatewayId: "ch_1" } as Cobranca;
  it("consulta charge e ordem Pix para moeda, vínculo, ciclo e pagamento", async () => {
    mocks.consultar.mockImplementation(async (path: string) => path.startsWith("/charges/")
      ? { id: "ch_1", currency: "BRL", amount: 9800, status: "paid", paid_at: "2026-12-15T12:00Z", paid_amount: 9800, canceled_amount: 0, order: { id: "or_1" } }
      : { id: "or_1", currency: "BRL", amount: 9800, customer: { id: "cus_1" }, metadata: { assinatura_gateway_id: "pixrec_a", vencimento: "2026-12-15" } });
    expect(await buscarProvaCobrancaCredito({ ...a, gatewayId: "pixrec_a" }, c, r)).toMatchObject({ moeda: "BRL", status: "PAGA", liquidadoCentavos: 9800, vencimento: "2026-12-15", assinaturaGatewayId: "pixrec_a" });
  });
  it("status sem moeda não vira prova monetária", async () => {
    mocks.consultar.mockResolvedValue({ id: "ch_1", amount: 9800, status: "paid" });
    await expect(buscarProvaCobrancaCredito(a, c, r)).rejects.toThrow();
  });
  it("fatura de cartão precisa ligar a cobrança, titular e o desconto reservado", async () => {
    mocks.consultar.mockImplementation(async (path: string) => path.startsWith("/charges/")
      ? { id: "ch_1", currency: "BRL", amount: 9800, status: "pending", invoice: { id: "in_1" } }
      : path.startsWith("/invoices/")
        ? { id: "in_1", charge: { id: "ch_1" }, subscription_id: "sub_1", customer: { id: "cus_1" }, currency: "BRL", amount: 9800, due_at: "2026-12-15T12:00Z", discounts: [d] }
        : d);
    expect(await buscarProvaCobrancaCredito(a, c, r)).toMatchObject({ status: "PENDENTE", descontoId: "dis_1", clienteGatewayId: "cus_1", assinaturaGatewayId: "sub_1" });
  });
});
