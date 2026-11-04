import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RodaBlack } from "@/components/jogos/roleta/RodaBlack";

describe("identificação acessível da roleta", () => {
  it("distingue a demonstração sem prêmio da jogada real", () => {
    const real = renderToStaticMarkup(createElement(RodaBlack, { fatias: [], podeGirar: true }));
    const teste = renderToStaticMarkup(createElement(RodaBlack, { fatias: [], podeGirar: true, rotuloBotao: "TESTAR", rotuloAcessivel: "Testar a roleta sem gerar prêmio" }));
    expect(real).toContain('aria-label="Girar a roleta"');
    expect(teste).toContain('aria-label="Testar a roleta sem gerar prêmio"');
  });
});
