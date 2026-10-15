import { describe, expect, it } from "vitest";
import { centavosStone, classificarStone, idStone, instanteStone, lerCsvStone, padraoDoNome, regraPara } from "@/lib/conciliacao/stone-regras";

const CAB = "Movimentação,Tipo,Valor,Saldo antes,Saldo depois,Tarifa,Data,Horário,Situação,Nosso Número,Destino,Destino Documento,Destino Instituição,Destino Agência,Destino Conta,Origem,Origem Documento,Origem Instituição,Origem Agência,Origem Conta,Descrição";
const linha = (mov: string, tipo: string, valor: string, destino: string, origem: string, tarifa = "Grátis") =>
  `${mov},${tipo},"${valor}","R$ 100,00","R$ 200,00",${tarifa},14/10/2026 20:36,20:36:32.567,FINISHED,,${destino},,,,,${origem},,,,,`;
const PROPRIAS = ["BLACK BARBER", "BLACK BARBEARIA"];

describe("extrato CSV da Stone", () => {
  const csv = [
    `﻿${CAB}`,
    linha("Crédito", "Transferência entre contas Stone", "5,96", "Black Barber 2", "Stone Principal"),
    linha("Crédito", "Transação", "65,00", "Black Barber 2", "Cliente da Silva", "\"R$ 0,09\""),
    linha("Crédito", "Pix", "14.000,00", "Black Barber 2", "BLACK BARBER LTDA"),
    linha("Débito", "Pix", "-650,00", "Fornecedor Teste Ltda", "Black Barber 2"),
    linha("Débito", "Pagamento", "-148,88", "CONCESSIONARIA DE ENERGIA S.A.", "Black Barber 2"),
    linha("Débito", "Pix", "-3.000,00", "BLACK BARBEARIA LTDA", "Black Barber 2"),
  ].join("\n");
  const ls = lerCsvStone(csv);

  it("le o arquivo com aspas, milhar e BOM", () => {
    expect(ls).toHaveLength(6);
    expect(centavosStone(ls[2]["Valor"])).toBe(1_400_000);
    expect(centavosStone(ls[3]["Valor"])).toBe(-65_000);
    expect(centavosStone(ls[1]["Tarifa"])).toBe(9);
    expect(centavosStone("Grátis")).toBe(0);
    expect(instanteStone(ls[0]).toISOString()).toBe("2026-10-14T23:36:32.567Z");
  });
  it("recusa arquivo que nao e o extrato", () => {
    expect(() => lerCsvStone("a,b,c\n1,2,3")).toThrow(/extrato CSV da Stone/);
  });
  it("classifica entradas e saidas", () => {
    expect(classificarStone(ls[0], PROPRIAS)).toMatchObject({ tipo: "RECEBIMENTO", forma: "CARTAO" });
    expect(classificarStone(ls[1], PROPRIAS)).toMatchObject({ tipo: "RECEBIMENTO", forma: "PIX", contraparte: "Cliente da Silva" });
    expect(classificarStone(ls[2], PROPRIAS)).toMatchObject({ tipo: "TRANSFERENCIA" });
    expect(classificarStone(ls[3], PROPRIAS)).toMatchObject({ tipo: "PAGAMENTO", forma: "PIX", contraparte: "Fornecedor Teste Ltda" });
    expect(classificarStone(ls[4], PROPRIAS)).toMatchObject({ tipo: "PAGAMENTO", forma: "BOLETO" });
    expect(classificarStone(ls[5], PROPRIAS)).toMatchObject({ tipo: "TRANSFERENCIA" });
  });
  it("id estavel: a mesma linha baixada de novo tem o mesmo id; linhas diferentes, ids diferentes", () => {
    expect(idStone(lerCsvStone(csv)[3])).toBe(idStone(ls[3]));
    expect(new Set(ls.map(idStone)).size).toBe(6);
  });
});

describe("regras por nome", () => {
  const regras = [
    { padrao: "CONCESSIONARIA", tipo: "PAGAMENTO" as const, categoria: "ENERGIA" },
    { padrao: "FULANO DE", tipo: "PAGAMENTO" as const, categoria: "COMISSAO" },
    { padrao: "FULANO DE TAL SOCIO", tipo: "PAGAMENTO" as const, categoria: "RETIRADA_SOCIO" },
  ];
  it("acha sem acento e o padrao mais especifico ganha", () => {
    expect(regraPara("Concessionária de Energia S.A.", regras)?.categoria).toBe("ENERGIA");
    expect(regraPara("Fulano de Tal Sócio", regras)?.categoria).toBe("RETIRADA_SOCIO");
    expect(regraPara("Fulano de Souza", regras)?.categoria).toBe("COMISSAO");
    expect(regraPara("Outro Nome", regras)).toBeNull();
    expect(regraPara(null, regras)).toBeNull();
  });
  it("padrao sugerido tira o CNPJ/CPF do comeco", () => {
    expect(padraoDoNome("57 074 417 Gabriel Alves")).toBe("GABRIEL ALVES");
    expect(padraoDoNome("61.648.056 Luan Henrique")).toBe("LUAN HENRIQUE");
  });
});
