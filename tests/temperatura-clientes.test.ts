import { describe, expect, it } from "vitest";
import { temperaturaDoCliente } from "@/lib/clientes/segmentos";
const hoje = Date.parse("2026-11-08T15:00:00Z");
describe("temperaturas para resgate", () => {
  it.each([[0, "quente"], [30, "quente"], [31, "morno"], [90, "morno"], [91, "frio"], [365, "frio"], [366, "muitoFrio"]] as const)("%i dias: %s", (dias, esperado) => {
    expect(temperaturaDoCliente(hoje - dias * 86_400_000, hoje)).toBe(esperado);
  });
  it("não inventa cliente perdido sem histórico ou com data futura", () => {
    expect(temperaturaDoCliente(null, hoje)).toBe("semVisitaRegistrada");
    expect(temperaturaDoCliente(null, hoje, false)).toBe("historicoIncompleto");
    expect(temperaturaDoCliente(hoje + 1, hoje)).toBe("historicoIncompleto");
  });
});
