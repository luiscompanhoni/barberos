import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/pagamentos/gateway", () => ({ provedorPagamento: () => "simulado" }));
import { limitarTentativas } from "@/lib/pagamentos/checkout";
const memoria = globalThis as unknown as { tentativasCheckout: Map<string, number[]>; expiracoesCheckout: Map<string, number> };
let rodada = 0;
beforeEach(() => {
  memoria.tentativasCheckout.clear(); memoria.expiracoesCheckout.clear();
  vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2030, 0, ++rodada * 3)));
});
afterEach(() => { vi.useRealTimers(); memoria.tentativasCheckout.clear(); memoria.expiracoesCheckout.clear(); });

describe("memória e janela dos limites de checkout", () => {
  it("mantém o limite legado por cobrança e libera depois da janela", () => {
    for (let i = 0; i < 5; i++) limitarTentativas("assinatura:existente:CARTAO");
    expect(() => limitarTentativas("assinatura:existente:CARTAO")).toThrow();
    expect(() => limitarTentativas("assinatura:outra:CARTAO")).not.toThrow();
    vi.advanceTimersByTime(3_600_001);
    expect(() => limitarTentativas("assinatura:existente:CARTAO")).not.toThrow();
  });

  it("remove chaves ociosas sem precisar consultá-las novamente", () => {
    limitarTentativas("acesso-ocioso", 1, 1000);
    vi.advanceTimersByTime(60_001);
    limitarTentativas("outra-origem", 1, 1000);
    expect(memoria.tentativasCheckout.has("acesso-ocioso")).toBe(false);
    expect(memoria.expiracoesCheckout.has("acesso-ocioso")).toBe(false);
    expect(memoria.tentativasCheckout.size).toBe(1);
  });

  it("satura de forma limitada sem expulsar o bloqueio de uma cobrança ativa", () => {
    limitarTentativas("cobranca-protegida", 1);
    let recusadas = 0;
    for (let i = 0; i < 12_000; i++) {
      try { limitarTentativas(`origem-${i}`, 1); } catch { recusadas++; }
    }
    expect(recusadas).toBeGreaterThan(0);
    expect(memoria.tentativasCheckout.size).toBeLessThan(12_000);
    expect(() => limitarTentativas("cobranca-protegida", 1)).toThrow();
    vi.advanceTimersByTime(3_600_001);
    expect(() => limitarTentativas("nova-origem", 1)).not.toThrow();
    expect(memoria.tentativasCheckout.size).toBe(1);
    expect(memoria.expiracoesCheckout.size).toBe(1);
  });

  it("não guarda identificadores de tamanho arbitrário", () => {
    expect(() => limitarTentativas("x".repeat(100_000))).toThrow();
    expect(memoria.tentativasCheckout.size).toBe(0);
  });
});
