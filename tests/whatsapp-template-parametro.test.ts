import { describe, expect, it } from "vitest";
import { montarMensagem } from "@/lib/campanhas/regras";
import { textoParametroTemplate } from "@/lib/whatsapp/template-parametro";

describe("parâmetro de modelo do WhatsApp oficial", () => {
  it("troca quebras de linha por separador e não deixa tab nem espaços repetidos", () => {
    const campanha = montarMensagem("Oi, {nome}!\nTrocamos de app.\n\nEntre aqui: {link}", { nome: "Ana Souza", barbearia: "Black", link: "https://x/c/r/abc" });
    const p = textoParametroTemplate(campanha);
    expect(p).toBe("Oi, Ana! · Trocamos de app. · Entre aqui: https://x/c/r/abc · Para não receber mais, responda PARAR.");
    expect(p).not.toMatch(/[\r\n\t]| {2,}/);
  });
  it("mantém texto de uma linha igual", () => {
    expect(textoParametroTemplate("Seu código é 123456.")).toBe("Seu código é 123456.");
    expect(textoParametroTemplate("a\t\tb    c\r\n")).toBe("a b c");
  });
});
