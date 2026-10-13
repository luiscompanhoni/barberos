import { describe, expect, it } from "vitest";
import { chances, comBonus, elegiveis, girosDisponiveis, multiplicador, sortear } from "@/lib/roleta/regras";

const P = (id: string, peso: number, extra: Partial<{ ativo: boolean; limiteMensal: number | null }> = {}) => ({ id, peso, ativo: true, limiteMensal: null, ...extra });

describe("roleta: sorteio por peso", () => {
  const ps = [P("a", 1), P("b", 3), P("c", 6)];
  it("cada faixa do numero sorteado cai no premio certo", () => {
    expect(sortear(ps, 0).id).toBe("a");
    expect(sortear(ps, 1).id).toBe("b");
    expect(sortear(ps, 3).id).toBe("b");
    expect(sortear(ps, 4).id).toBe("c");
    expect(sortear(ps, 9).id).toBe("c");
  });
  it("a frequencia bate com a chance (varrendo todos os numeros)", () => {
    const n = new Map<string, number>();
    for (let r = 0; r < 10; r++) n.set(sortear(ps, r).id, (n.get(sortear(ps, r).id) ?? 0) + 1);
    expect([n.get("a"), n.get("b"), n.get("c")]).toEqual([1, 3, 6]);
  });
  it("recusa numero fora da faixa e lista vazia", () => {
    expect(() => sortear(ps, 10)).toThrow();
    expect(() => sortear([], 0)).toThrow();
  });
});

describe("roleta: elegiveis e chances", () => {
  it("tira inativos, peso zero e quem bateu o limite do mes", () => {
    const ps = [P("a", 5), P("b", 0), P("c", 5, { ativo: false }), P("d", 5, { limiteMensal: 2 }), P("e", 5, { limiteMensal: 2 })];
    const r = elegiveis(ps, new Map([["d", 2], ["e", 1]])).map((p) => p.id);
    expect(r).toEqual(["a", "e"]);
  });
  it("chance em % so entre os ativos", () => {
    const c = chances([P("a", 1), P("b", 3), P("x", 50, { ativo: false })]);
    expect(c.get("a")).toBe(25);
    expect(c.get("b")).toBe(75);
    expect(c.get("x")).toBe(0);
  });
});

describe("roleta: bonus e giros", () => {
  it("assinante ganha o bonus nos premios em dinheiro", () => {
    expect(multiplicador(true, 10)).toBe(110);
    expect(multiplicador(false, 10)).toBe(100);
    expect(comBonus(500, 110)).toBe(550);
  });
  it("giros por atendimento menos os ja usados", () => {
    const g = girosDisponiveis({ atendimentos: 3, girosPorAtendimento: 2, usadosPorAtendimento: 4, giroGratisDias: 0, ultimoGratis: null, agora: 0 });
    expect(g).toMatchObject({ porAtendimento: 2, gratis: false, total: 2, proximoGratisEm: null });
  });
  it("giro gratis libera depois do intervalo", () => {
    const agora = Date.UTC(2026, 9, 10);
    expect(girosDisponiveis({ atendimentos: 0, girosPorAtendimento: 1, usadosPorAtendimento: 0, giroGratisDias: 7, ultimoGratis: null, agora }).total).toBe(1);
    const recente = girosDisponiveis({ atendimentos: 0, girosPorAtendimento: 1, usadosPorAtendimento: 0, giroGratisDias: 7, ultimoGratis: new Date(agora - 3 * 86_400_000), agora });
    expect(recente.total).toBe(0);
    expect(recente.proximoGratisEm?.toISOString().slice(0, 10)).toBe("2026-10-14");
  });
});
