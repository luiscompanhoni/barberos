import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EntradaWebhook } from "@/lib/pagamentos/webhook-entrada";

const m = vi.hoisted(() => ({ estado: "PENDENTE", carga: { fonte: "celcash", evento: "evento-ficticio", tipo: "transaction.updateStatus", cobranca: "celtx_ficticia" } as EntradaWebhook, auditar: vi.fn() }));
vi.mock("@/lib/db", () => {
  const tx = { $executeRaw: vi.fn(), webhookPagamentoEntrada: {
    findUnique: async () => ({ chaveSequencia: "sequencia-ficticia", estado: m.estado }),
    findUniqueOrThrow: async () => ({ carga: m.carga }),
    findFirst: async ({ where }: { where: { id?: { not: string } } }) => where.id ? null : { id: "entrada-ficticia" },
    updateMany: async ({ where, data }: { where: { estado: string }; data: { estado: string } }) => {
      if (where.estado !== m.estado) return { count: 0 };
      m.estado = data.estado; return { count: 1 };
    },
  } };
  return { db: { ...tx, $transaction: async (fn: (c: typeof tx) => Promise<unknown>) => fn(tx) } };
});
vi.mock("@/lib/auditoria", () => ({ auditar: m.auditar }));
vi.mock("@/lib/recuperacao/quarentena", () => ({ quarentenaRestauracao: () => false }));
import { FalhaSincronizacaoAssinatura } from "@/lib/assinaturas/eventos";
import { processarWebhookEntrada } from "@/lib/pagamentos/webhook-entrada";

beforeEach(() => {
  vi.clearAllMocks(); m.estado = "PENDENTE";
  m.carga = { fonte: "celcash", evento: "evento-ficticio", tipo: "transaction.updateStatus", cobranca: "celtx_ficticia" };
  m.auditar.mockResolvedValue(undefined);
});

describe("retentativa restrita à reconciliação de assinatura", () => {
  it("falha tipada recuperável retorna à fila e a próxima execução conclui", async () => {
    await processarWebhookEntrada("entrada-ficticia", async () => { throw new FalhaSincronizacaoAssinatura(true); });
    expect(m.estado).toBe("PENDENTE");
    expect(m.auditar).toHaveBeenCalledWith(expect.anything(), null, "webhook_assinatura_retentar", "webhook_pagamento_entrada", "entrada-ficticia");
    await processarWebhookEntrada("entrada-ficticia", async () => {});
    expect(m.estado).toBe("CONCLUIDO");
  });
  it.each([new Error("Timeout externo ambíguo"), new FalhaSincronizacaoAssinatura(false)])("outras falhas permanecem em revisão e não repetem", async erro => {
    const executar = vi.fn(async () => { throw erro; });
    await processarWebhookEntrada("entrada-ficticia", executar);
    expect(m.estado).toBe("REVISAO");
    expect(await processarWebhookEntrada("entrada-ficticia", executar)).toBe(false);
    expect(executar).toHaveBeenCalledOnce();
  });
  it("evento Pagar.me que também envolve pedido não é reaberto automaticamente", async () => {
    m.carga = { fonte: "pagarme", evento: "evento-ficticio", tipo: "charge.paid", cobrancas: ["ch_ficticia"], pedido: "or_ficticio", assinaturaCancelada: null };
    await processarWebhookEntrada("entrada-ficticia", async () => { throw new FalhaSincronizacaoAssinatura(true); });
    expect(m.estado).toBe("REVISAO");
  });
  it("evento Pagar.me exclusivamente de assinatura pode ser reconsultado", async () => {
    m.carga = { fonte: "pagarme", evento: "evento-ficticio", tipo: "charge.paid", cobrancas: ["ch_ficticia"], pedido: null, assinaturaCancelada: null };
    await processarWebhookEntrada("entrada-ficticia", async () => { throw new FalhaSincronizacaoAssinatura(true); });
    expect(m.estado).toBe("PENDENTE");
  });
  it("finalização atrasada não retira uma entrada de revisão", async () => {
    await processarWebhookEntrada("entrada-ficticia", async () => { m.estado = "REVISAO"; });
    expect(m.estado).toBe("REVISAO");
  });
});
