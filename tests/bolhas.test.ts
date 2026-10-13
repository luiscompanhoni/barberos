import { describe, expect, it } from "vitest";
import { dividirEmBolhas, tempoDigitando } from "@/lib/bot/bolhas";

describe("resposta do bot em bolhas", () => {
  it("cada parágrafo vira uma mensagem", () => {
    expect(dividirEmBolhas("Opa, Luis!\n\nQuarta com o Tainan tenho 10:30 ou 14:00. Algum serve?")).toEqual([
      "Opa, Luis!", "Quarta com o Tainan tenho 10:30 ou 14:00. Algum serve?",
    ]);
  });
  it("lista sem linha em branco fica na mesma bolha", () => {
    expect(dividirEmBolhas("Tenho:\n• 10:30 com o Tainan\n• 14:00 com o Fauli")).toEqual(["Tenho:\n• 10:30 com o Tainan\n• 14:00 com o Fauli"]);
  });
  it("no máximo 3: o excesso vai junto na última", () => {
    expect(dividirEmBolhas("a\n\nb\n\nc\n\nd")).toEqual(["a", "b", "c\n\nd"]);
  });
  it("ignora espaços e parágrafos vazios; texto vazio não envia nada", () => {
    expect(dividirEmBolhas("  oi  \n\n\n \n tudo certo? ")).toEqual(["oi", "tudo certo?"]);
    expect(dividirEmBolhas("")).toEqual([]);
  });
  it("digitando proporcional ao tamanho, entre 1,2 s e 4 s", () => {
    expect(tempoDigitando("ok")).toBe(1200);
    expect(tempoDigitando("x".repeat(100))).toBe(2500);
    expect(tempoDigitando("x".repeat(1000))).toBe(4000);
  });
});
