import { describe, expect, it } from "vitest";
import { centavosStone, idStone, instanteStone, lerCsvStone } from "@/lib/conciliacao/stone-regras";
const linha = { Data: "28/02/2026 14:00", Horário: "14:00:00.1", Valor: "100,00", "Saldo antes": "R$ 1.000,00", "Saldo depois": "1.100,00", Tipo: "Pix", Movimentação: "Crédito", Origem: "Cliente fictício" };
describe("importação monetária estrita", () => {
  it.each(["abc", "", "1,234", "1.00", "NaN", "1.000,001", "--10,00"])("recusa valor inválido %s sem inventar zero", v => expect(() => centavosStone(v)).toThrow());
  it("mantém centavos e aceita sinal e formatação monetária", () => {
    expect(centavosStone("R$ 1.234,56")).toBe(123456);
    expect(centavosStone("-650,00")).toBe(-65000);
    expect(centavosStone("Grátis")).toBe(0);
  });
  it("recusa calendário impossível e horário ausente", () => {
    expect(() => instanteStone({ ...linha, Data: "31/02/2026" })).toThrow();
    expect(() => instanteStone({ ...linha, Horário: "24:00" })).toThrow();
    expect(() => instanteStone({ ...linha, Data: "28/02/2026", Horário: "" })).toThrow();
    expect(instanteStone(linha).toISOString()).toBe("2026-02-28T17:00:00.100Z");
  });
  it("identidade ignora apenas mudanças de formatação dos mesmos valores", () => {
    expect(idStone(linha)).toBe(idStone({ ...linha, Valor: "R$ 100,00", "Saldo antes": "1000,00", Data: "28/02/2026", Horário: "14:00:00.100" }));
    expect(idStone(linha)).not.toBe(idStone({ ...linha, Valor: "100,01" }));
    expect(idStone(linha)).toBe(idStone({ ...linha, Origem: "CLIENTE FICTÍCIO (nome atualizado)" }));
  });
  it("rejeita cabeçalho incompleto, aspas abertas e linhas truncadas", () => {
    expect(() => lerCsvStone("Movimentação,Saldo depois\nCrédito,0")).toThrow();
    expect(() => lerCsvStone('"Data')).toThrow(/aspas/);
    expect(() => lerCsvStone("Data,Horário,Movimentação,Tipo,Valor,Saldo antes,Saldo depois\n28/02/2026,14:00,Crédito,Pix,0,0")).toThrow(/Linha 2/);
  });
});
