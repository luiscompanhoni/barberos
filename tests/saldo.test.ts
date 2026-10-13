import { describe, expect, it } from "vitest";
import { valorCashback } from "@/lib/comandas/regras";
import { ordemDeUso, planoDeUso } from "@/lib/crescimento/saldo";

describe("saldo", () => {
  it("usa primeiro o que vence antes; sem validade por ultimo", () => {
    const d = (s: string) => new Date(s);
    const xs = [
      { id: "sem", expiraEm: null, criadoEm: d("2026-01-01") },
      { id: "dez", expiraEm: d("2026-12-01"), criadoEm: d("2026-01-02") },
      { id: "nov", expiraEm: d("2026-11-01"), criadoEm: d("2026-01-03") },
    ];
    expect(ordemDeUso(xs).map((x) => x.id)).toEqual(["nov", "dez", "sem"]);
  });
  it("cobre o valor e divide so o ultimo credito", () => {
    const cs = [{ id: "a", valorCentavos: 500 }, { id: "b", valorCentavos: 2000 }, { id: "c", valorCentavos: 300 }];
    expect(planoDeUso(cs, 1200)).toEqual([{ id: "a", usa: 500, sobra: 0 }, { id: "b", usa: 700, sobra: 1300 }]);
    expect(planoDeUso(cs, 5000).reduce((t, p) => t + p.usa, 0)).toBe(2800); // saldo menor que a conta: usa tudo
  });
  it("cashback arredonda para baixo e ignora valores zerados", () => {
    expect(valorCashback(4590, 5)).toBe(229);
    expect(valorCashback(0, 5)).toBe(0);
    expect(valorCashback(1000, 0)).toBe(0);
    expect(valorCashback(1000, 500)).toBe(1000); // nunca passa de 100%
  });
});
