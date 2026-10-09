import { describe, expect, it } from "vitest";
import { calcularComissao, csvFolha, escolherRegra, intervaloCompetencia, REGRA_SUGERIDA, resumirComissoes, totaisFolha, type RegraSalva } from "@/lib/rh/regras";

const geral: RegraSalva = { servicoId: "corte", barbeiroId: null, ...REGRA_SUGERIDA };
const excecao: RegraSalva = { servicoId: "corte", barbeiroId: "joao", avulsoTipo: "PERCENTUAL", avulsoValor: 5000, planoTipo: "PERCENTUAL", planoValor: 3000 };

describe("comissoes", () => {
  it("excecao do barbeiro substitui a regra geral; sem regra = null", () => {
    expect(escolherRegra([geral, excecao], "corte", "joao")).toBe(excecao);
    expect(escolherRegra([geral, excecao], "corte", "pedro")).toBe(geral);
    expect(escolherRegra([geral], "barba", "pedro")).toBeNull();
  });
  it("avulso: % do valor cobrado; plano: fixo por corte ou % da tabela", () => {
    expect(calcularComissao(geral, { modalidade: "AVULSO", preco: 5000, precoTabela: 5000 })).toEqual({ base: 5000, comissao: 2000, regra: "40% do valor" });
    expect(calcularComissao(geral, { modalidade: "PLANO", preco: 0, precoTabela: 5000 })).toEqual({ base: 5000, comissao: 1500, regra: "R$ 15,00 fixo" });
    expect(calcularComissao(excecao, { modalidade: "PLANO", preco: 0, precoTabela: 4500 })).toEqual({ base: 4500, comissao: 1350, regra: "30% da tabela" });
    expect(calcularComissao({ ...geral, avulsoTipo: "FIXO", avulsoValor: 1000 }, { modalidade: "AVULSO", preco: 7000, precoTabela: 5000 }).comissao).toBe(1000);
    expect(calcularComissao(null, { modalidade: "AVULSO", preco: 5000, precoTabela: 5000 })).toEqual({ base: 5000, comissao: 0, regra: "Sem regra" });
  });
  it("percentual arredonda para o centavo", () => {
    expect(calcularComissao({ ...geral, avulsoValor: 3333 }, { modalidade: "AVULSO", preco: 4590, precoTabela: 0 }).comissao).toBe(1530);
  });
  it("resumo por barbeiro: avulso, plano, total e sem regra", () => {
    const r = resumirComissoes([
      { id: "1", barbeiroId: "pedro", servicoId: "corte", preco: 5000, precoTabela: 5000, plano: false },
      { id: "2", barbeiroId: "pedro", servicoId: "corte", preco: 0, precoTabela: 5000, plano: true },
      { id: "3", barbeiroId: "pedro", servicoId: "barba", preco: 3000, precoTabela: 3000, plano: false },
      { id: "4", barbeiroId: "joao", servicoId: "corte", preco: 6000, precoTabela: 5000, plano: false },
    ], [geral, excecao]);
    const pedro = r.find((x) => x.barbeiroId === "pedro")!;
    expect(pedro.avulso).toEqual({ qtd: 2, base: 8000, comissao: 2000 });
    expect(pedro.plano).toEqual({ qtd: 1, base: 5000, comissao: 1500 });
    expect(pedro.total).toBe(3500);
    expect(pedro.semRegra).toBe(1);
    expect(r.find((x) => x.barbeiroId === "joao")!.total).toBe(3000);
  });
});

describe("folha", () => {
  it("liquido = salario + comissao + adicionais/bonus - vales/descontos", () => {
    expect(totaisFolha({ salario: 200000, comissao: 35000, lancamentos: [
      { tipo: "ADICIONAL", valorCentavos: 10000 }, { tipo: "BONUS", valorCentavos: 5000 },
      { tipo: "VALE", valorCentavos: 30000 }, { tipo: "DESCONTO", valorCentavos: 2000 },
    ] })).toEqual({ salario: 200000, comissao: 35000, adicionais: 15000, descontos: 32000, liquido: 218000 });
    expect(totaisFolha({ salario: 0, comissao: 0, lancamentos: [{ tipo: "VALE", valorCentavos: 5000 }] }).liquido).toBe(-5000);
  });
  it("intervalo da competencia (fevereiro bissexto, dezembro)", () => {
    expect(intervaloCompetencia("2028-02")).toEqual({ inicio: "2028-02-01", fim: "2028-02-29" });
    expect(intervaloCompetencia("2026-12")).toEqual({ inicio: "2026-12-01", fim: "2026-12-31" });
    expect(() => intervaloCompetencia("2026-13")).toThrow();
  });
  it("CSV com ; , valores em reais e linha de total", () => {
    const csv = csvFolha("2026-10", [
      { nome: "Ana; Souza", cargo: "Recepção", salario: 150000, comissao: 0, adicionais: 0, descontos: 10000, liquido: 140000, status: "Fechada", chavePix: null },
      { nome: "Pedro", cargo: null, salario: 0, comissao: 35050, adicionais: 0, descontos: 0, liquido: 35050, status: "Paga", chavePix: "pedro@x" },
    ]).split("\r\n");
    expect(csv[0]).toBe("Competência;Funcionário;Cargo;Salário;Comissão;Adicionais;Descontos;Líquido;Situação;Chave Pix");
    expect(csv[1]).toBe('2026-10;"Ana; Souza";Recepção;1500,00;0,00;0,00;100,00;1400,00;Fechada;');
    expect(csv[3]).toBe("2026-10;TOTAL;;1500,00;350,50;0,00;100,00;1750,50;;");
  });
});
