import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ registrar: vi.fn(), agendar: vi.fn(), processar: vi.fn() }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: mocks.agendar }));
vi.mock("@/lib/pagamentos/webhook-entrada", () => ({ registrarWebhookPagamento: mocks.registrar, processarWebhookEntrada: mocks.processar }));

import { POST as asaas } from "@/app/api/pagamentos/webhook/route";
import { POST as celcash } from "@/app/api/pagamentos/celcash/webhook/route";
import { POST as pagarme } from "@/app/api/pagamentos/pagarme/webhook/route";

const json = (corpo: object, headers: Record<string, string> = {}) => ({ method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(corpo) });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ASAAS_WEBHOOK_TOKEN", "fake");
  vi.stubEnv("CELCASH_WEBHOOK_TOKEN", "fake");
  vi.stubEnv("CELCASH_WEBHOOK_HASH", "");
  vi.stubEnv("PAGARME_WEBHOOK_TOKEN", "fake");
  mocks.registrar.mockResolvedValue("entrada-fake");
});
afterEach(() => vi.unstubAllEnvs());

describe("webhooks persistem antes do sucesso", () => {
  const exemplos = [
    { nome: "Asaas", executar: asaas, req: () => new Request("https://localhost/webhook", json({ id: "evento-1", event: "PAYMENT_RECEIVED", payment: { id: "c1" } }, { "asaas-access-token": "fake" })) },
    { nome: "Celcash", executar: celcash, req: () => new Request("https://localhost/webhook?token=fake", json({ event: "transaction.updateStatus", webhookId: 1, Transaction: { galaxPayId: 2 } })) },
    { nome: "Pagar.me", executar: pagarme, req: () => new Request("https://localhost/webhook?token=fake", json({ id: "evento-1", type: "charge.paid", data: { id: "ch1" } })) },
  ];
  for (const { nome, executar, req } of exemplos) {
    it(`${nome}: falha de persistência responde 503 sem agendar`, async () => {
      mocks.registrar.mockRejectedValueOnce(new Error("banco indisponível"));
      expect((await executar(req())).status).toBe(503);
      expect(mocks.agendar).not.toHaveBeenCalled();
    });
    it(`${nome}: só responde sucesso após persistir`, async () => {
      let concluir!: (v: string) => void;
      mocks.registrar.mockImplementationOnce(() => new Promise((r) => { concluir = r; }));
      let terminou = false;
      const resposta = executar(req()).then((v) => { terminou = true; return v; });
      await vi.waitFor(() => expect(mocks.registrar).toHaveBeenCalledOnce());
      expect(terminou).toBe(false);
      concluir("entrada-fake");
      expect((await resposta).status).toBe(200);
      expect(mocks.agendar).toHaveBeenCalledOnce();
    });
    it(`${nome}: quarentena responde 503 e não confirma nem agenda`, async () => {
      vi.stubEnv("BARBEROS_QUARENTENA_RESTAURACAO", "true");
      expect((await executar(req())).status).toBe(503);
      expect(mocks.registrar).not.toHaveBeenCalled();
      expect(mocks.agendar).not.toHaveBeenCalled();
    });
  }
  it("Celcash preserva duas entregas da mesma transação mesmo com webhookId igual", async () => {
    const requisicao = () => new Request("https://localhost/webhook?token=fake", json({ event: "transaction.updateStatus", webhookId: 1, Transaction: { galaxPayId: 2 } }));
    expect((await celcash(requisicao())).status).toBe(200);
    expect((await celcash(requisicao())).status).toBe(200);
    const [a, b] = mocks.registrar.mock.calls.map(([entrada]) => entrada);
    expect(a.cobranca).toBe(b.cobranca);
    expect(a.evento).not.toBe(b.evento);
  });
});
