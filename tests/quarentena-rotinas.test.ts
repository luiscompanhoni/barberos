import { afterEach, describe, expect, it, vi } from "vitest";

// Qualquer consulta mostra que a quarentena foi ultrapassada; nenhuma conexão é aberta.
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: () => { throw new Error("Banco não deve ser acessado"); } }) }));
import { rodarRotinaDePagamentos } from "@/lib/assinaturas/rotina";
import { rodarAutomacoes } from "@/lib/automacoes/rotina";
import { processarCobrancasAutomaticas } from "@/lib/assinaturas/cobranca-automatica-rotina";
import { processarWebhookEntrada, recuperarWebhooksPagamento, registrarWebhookPagamento } from "@/lib/pagamentos/webhook-entrada";

afterEach(() => vi.unstubAllEnvs());
describe("rotinas e webhooks em quarentena", () => {
  it("não acessa banco, gateway nem transporte mesmo com flag de cobrança ativa", async () => {
    vi.stubEnv("BARBEROS_QUARENTENA_RESTAURACAO", "true");
    vi.stubEnv("COBRANCA_AUTOMATICA_WHATSAPP_ATIVA", "true");
    expect(await rodarRotinaDePagamentos()).toEqual({ pix: 0, vencidas: 0, celcash: 0, reativadas: 0, encerradas: 0 });
    expect(Object.values(await rodarAutomacoes()).every((n) => n === 0)).toBe(true);
    expect(await processarCobrancasAutomaticas()).toEqual({ processadas: 0 });
    expect(await processarWebhookEntrada("fake")).toBe(false);
    expect(await recuperarWebhooksPagamento()).toBe(0);
    await expect(registrarWebhookPagamento({ fonte: "asaas", evento: "e", tipo: "PAYMENT_RECEIVED", cobranca: "c" })).rejects.toThrow("pausados");
  });
});
