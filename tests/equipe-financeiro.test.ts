import { describe, expect, it } from "vitest";
import { ciclosDaCampanha, resumoPessoal } from "@/lib/equipe-regras";
import { escolherSugestoes } from "@/lib/crescimento/regras";
describe("metas da equipe", () => {
  it("exige as duas metas e não reutiliza sobra como ciclo completo", () => {
    expect(ciclosDaCampanha(10, 30000, 10, 30000)).toBe(1);
    expect(ciclosDaCampanha(20, 59999, 10, 30000)).toBe(1);
    expect(ciclosDaCampanha(9, 100000, 10, 30000)).toBe(0);
    expect(ciclosDaCampanha(20, 60000, 10, 30000)).toBe(2);
    expect(ciclosDaCampanha(25, 1000, 10, 0)).toBe(2);
  });
  it("separa realizados e previstos sem duplicar receitas", () => {
    const r = resumoPessoal([
      { tipo:"RECEITA", valorCentavos:10000, realizado:true, categoria:"Comissão" },
      { tipo:"DESPESA", valorCentavos:3000, realizado:true, categoria:"Alimentação" },
      { tipo:"DESPESA", valorCentavos:2000, realizado:false, categoria:"Moradia" },
      { tipo:"RECEITA", valorCentavos:4000, realizado:false, categoria:"Comissão" },
    ]);
    expect(r).toEqual({ receitas:10000, despesas:3000, saldo:7000, projetado:9000, categorias:{ Alimentação:3000 } });
  });
  it("oferece o horário habitual livre com o barbeiro preferido", () => {
    const op = (b:string,m:number) => ({ barbeiroId:b,nome:b,minutos:m,inicio:`${b}-${m}` });
    expect(escolherSugestoes([op("a",540),op("a",840),op("a",900),op("b",840)],2,"a",840).map(o=>o.minutos)).toEqual([840,900]);
    expect(escolherSugestoes([op("a",540),op("a",840)],1)).toHaveLength(1);
  });
});
