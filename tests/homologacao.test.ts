import { afterEach, describe, expect, it, vi } from "vitest";
import { modoMaquininha } from "@/lib/comandas/maquininha";
import { provedorPagamento } from "@/lib/pagamentos/gateway";
import { provedorWhatsApp } from "@/lib/whatsapp/canal";

afterEach(() => vi.unstubAllEnvs());

describe("homologacao: nada sai de verdade", () => {
  it("com chave real no .env, AMBIENTE=homologacao forca WhatsApp, pagamento e maquininha simulados", () => {
    vi.stubEnv("AMBIENTE", "producao");
    vi.stubEnv("WHATSAPP_PROVIDER", "cloud"); vi.stubEnv("PAGAMENTOS_PROVIDER", "pagarme"); vi.stubEnv("MAQUININHA", "stone");
    expect([provedorWhatsApp(), provedorPagamento(), modoMaquininha()]).toEqual(["cloud", "pagarme", "stone"]);
    vi.stubEnv("AMBIENTE", "homologacao");
    expect([provedorWhatsApp(), provedorPagamento(), modoMaquininha()]).toEqual(["simulador", "simulado", "simulada"]);
  });
});
