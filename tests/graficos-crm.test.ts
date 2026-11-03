import { describe, expect, it } from "vitest";
import { dominioCrm, segmentosCrm, resumoRoscaCrm } from "@/components/visual/graficos-crm-regras";

describe("dados visuais dos gráficos CRM", () => {
  it("mantém o zero e estornos negativos na escala, sem truncar perdas", () => {
    expect(dominioCrm([[100, 102]])).toEqual([0, 102]);
    expect(dominioCrm([[20, -80], [40]])).toEqual([-80, 40]);
    expect(dominioCrm([[-80, -40]])).toEqual([-80, 0]);
  });
  it("distingue ausência de zero e não liga uma curva sobre dados ausentes", () => {
    expect(segmentosCrm([5, null, 0, Number.NaN, 2, 3])).toEqual([
      [{ indice: 0, valor: 5 }], [{ indice: 2, valor: 0 }], [{ indice: 4, valor: 2 }, { indice: 5, valor: 3 }],
    ]);
    expect(dominioCrm([[null, Number.NaN, Infinity]])).toEqual([0, 1]);
    expect(dominioCrm([[0, 0]])).toEqual([0, 1]);
  });
  it("só representa uma distribuição quando todas as partes são válidas e positivas ou zero", () => {
    expect(resumoRoscaCrm([{ valor: 20 }, { valor: 0 }, { valor: 30 }])).toMatchObject({ total: 50, desenhar: true });
    expect(resumoRoscaCrm([{ valor: 20 }, { valor: -5 }])).toMatchObject({ total: 15, negativo: true, desenhar: false });
    expect(resumoRoscaCrm([{ valor: 20 }, { valor: null }])).toMatchObject({ total: null, indisponivel: true, desenhar: false });
    expect(resumoRoscaCrm([{ valor: 0 }])).toMatchObject({ total: 0, desenhar: false });
    expect(resumoRoscaCrm([{ valor: Number.MAX_VALUE }, { valor: Number.MAX_VALUE }])).toMatchObject({ total: null, desenhar: false });
  });
});
