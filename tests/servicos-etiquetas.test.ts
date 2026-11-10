import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EtiquetasServico } from "@/components/servicos/EtiquetasServico";
import { etiquetasDoServico, raioDaEtiqueta, textoDaEtiqueta, zSalvarEtiquetasServico } from "@/lib/servicos/etiquetas";

const etiqueta = { texto: "Destaque", cor: "#F9CB30", formato: "PILULA" };
const luminancia = (hex: string) => {
  const canais = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return canais[0] * 0.2126 + canais[1] * 0.7152 + canais[2] * 0.0722;
};

describe("etiquetas editáveis de serviços", () => {
  it("aceita remoção total, texto livre e formato diferente, normalizando cor", () => {
    expect(zSalvarEtiquetasServico.parse({ versao: 0, etiquetas: [] }).etiquetas).toEqual([]);
    expect(zSalvarEtiquetasServico.parse({ versao: 2, etiquetas: [{ ...etiqueta, texto: "  PREFERIDO DA GALERA  ", cor: "#b16adf", formato: "RETANGULAR" }] }))
      .toEqual({ versao: 2, etiquetas: [{ texto: "PREFERIDO DA GALERA", cor: "#B16ADF", formato: "RETANGULAR" }] });
  });
  it.each([
    { ...etiqueta, texto: "" }, { ...etiqueta, texto: "x".repeat(41) }, { ...etiqueta, texto: "<img src=x>" },
    { ...etiqueta, texto: "Oculto\u0000" }, { ...etiqueta, cor: "url(https://externo.test/a)" }, { ...etiqueta, cor: "red" },
    { ...etiqueta, formato: "<svg>" }, { ...etiqueta, style: "position:fixed" },
  ])("recusa HTML, CSS, formato ou texto inválido: %j", valor => {
    expect(zSalvarEtiquetasServico.safeParse({ versao: 0, etiquetas: [valor] }).success).toBe(false);
  });
  it("limita quantidade, versão e campos alteráveis", () => {
    expect(zSalvarEtiquetasServico.safeParse({ versao: 0, etiquetas: Array(7).fill(etiqueta) }).success).toBe(false);
    expect(zSalvarEtiquetasServico.safeParse({ versao: -1, etiquetas: [] }).success).toBe(false);
    expect(zSalvarEtiquetasServico.safeParse({ versao: 0, etiquetas: [], precoCentavos: 0 }).success).toBe(false);
  });
  it.each([undefined, null, {}, "Destaque", [{ ...etiqueta, cor: "red" }]])("não publica dados legados ou inválidos: %j", valor => {
    expect(etiquetasDoServico(valor)).toEqual([]);
  });
  it("mantém contraste de pelo menos 4,5:1 em cores claras, escuras e intermediárias", () => {
    for (let r = 0; r <= 255; r += 17) for (let g = 0; g <= 255; g += 17) for (let b = 0; b <= 255; b += 17) {
      const cor = `#${[r, g, b].map(n => n.toString(16).padStart(2, "0")).join("")}`;
      const fundo = luminancia(cor), texto = luminancia(textoDaEtiqueta(cor));
      expect((Math.max(fundo, texto) + 0.05) / (Math.min(fundo, texto) + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("renderiza texto escapado com forma e cor editadas, sem interação aninhada", () => {
    const html = renderToStaticMarkup(createElement(EtiquetasServico, { etiquetas: [{ ...etiqueta, texto: "Corte & barba", formato: "ARREDONDADA" }] }));
    expect(html).toContain("Corte &amp; barba"); expect(html).toContain("background-color:#F9CB30");
    expect(html).toContain("color:#000000"); expect(html).toContain("border-radius:8px");
    expect(html).not.toContain("<button");
    expect(raioDaEtiqueta("PILULA")).toBe("999px"); expect(raioDaEtiqueta("RETANGULAR")).toBe("0px");
    expect(renderToStaticMarkup(createElement(EtiquetasServico, { etiquetas: [] }))).toBe("");
  });
});
