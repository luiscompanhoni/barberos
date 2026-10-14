import { afterEach, describe, expect, it } from "vitest";
import { modoMaquininha } from "@/lib/comandas/maquininha";
import { provedorPagamento } from "@/lib/pagamentos/gateway";
import { provedorWhatsApp } from "@/lib/whatsapp/canal";

const antes = { ...process.env };
afterEach(() => { process.env = { ...antes }; });

describe("homologacao: nada sai de verdade", () => {
  it("com chave real no .env, AMBIENTE=homologacao forca WhatsApp, pagamento e maquininha simulados", () => {
    Object.assign(process.env, { WHATSAPP_PROVIDER: "cloud", PAGAMENTOS_PROVIDER: "pagarme", MAQUININHA: "stone" });
    expect([provedorWhatsApp(), provedorPagamento(), modoMaquininha()]).toEqual(["cloud", "pagarme", "stone"]);
    process.env.AMBIENTE = "homologacao";
    expect([provedorWhatsApp(), provedorPagamento(), modoMaquininha()]).toEqual(["simulador", "simulado", "simulada"]);
  });
});
