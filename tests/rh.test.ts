import { describe, expect, it } from "vitest";
import {
  adicionalNoDia, calcularAssinaturas, calcularComissao, comissaoProdutos, competenciaFechadaNoPeriodo, csvFolha, escolherRegra, faixaAlcancada,
  intervaloCompetencia, periodosSeCruzam, REGRA_SUGERIDA, resumirComissoes, totaisFolha, valorCobradoItem, type Adicional, type FaixaProduto, type RegraSalva,
} from "@/lib/rh/regras";

const geral: RegraSalva = { servicoId: "corte", barbeiroId: null, ...REGRA_SUGERIDA };
const excecao: RegraSalva = { servicoId: "corte", barbeiroId: "joao", avulsoTipo: "PERCENTUAL", avulsoValor: 5000, planoTipo: "PERCENTUAL", planoValor: 3000 };

describe("comissoes", () => {
  it("excecao do barbeiro substitui a regra geral; sem regra = null", () => {
    expect(escolherRegra([geral, excecao], "corte", "joao")).toBe(excecao);
    expect(escolherRegra([geral, excecao], "corte", "pedro")).toBe(geral);
    expect(escolherRegra([geral], "barba", "pedro")).toBeNull();
  });
  it("avulso: % do valor cobrado; plano: fixo por corte ou % da tabela", () => {
    expect(calcularComissao(geral, { modalidade: "AVULSO", preco: 5000, precoTabela: 5000 })).toEqual({ base: 5000, comissao: 2000, adicional: 0, regra: "40% do valor" });
    expect(calcularComissao(geral, { modalidade: "PLANO", preco: 0, precoTabela: 5000 })).toEqual({ base: 5000, comissao: 1500, adicional: 0, regra: "R$ 15,00 fixo" });
    expect(calcularComissao(excecao, { modalidade: "PLANO", preco: 0, precoTabela: 4500 })).toEqual({ base: 4500, comissao: 1350, adicional: 0, regra: "30% da tabela" });
    expect(calcularComissao({ ...geral, avulsoTipo: "FIXO", avulsoValor: 1000 }, { modalidade: "AVULSO", preco: 7000, precoTabela: 5000 }).comissao).toBe(1000);
    expect(calcularComissao(null, { modalidade: "AVULSO", preco: 5000, precoTabela: 5000 })).toEqual({ base: 5000, comissao: 0, adicional: 0, regra: "Sem regra" });
  });
  it("adicional (pontos) soma ao % da regra; regra fixa nao muda", () => {
    expect(calcularComissao(geral, { modalidade: "AVULSO", preco: 5000, precoTabela: 5000 }, 500)).toEqual({ base: 5000, comissao: 2250, adicional: 250, regra: "40% do valor + 5 pts" });
    expect(calcularComissao(geral, { modalidade: "PLANO", preco: 0, precoTabela: 5000 }, 500)).toEqual({ base: 5000, comissao: 1500, adicional: 0, regra: "R$ 15,00 fixo" });
    expect(calcularComissao(geral, { modalidade: "AVULSO", preco: 5000, precoTabela: 5000 }, -500).regra).toBe("40% do valor − 5 pts");
  });
  it("valor efetivamente cobrado: desconto e estornos da comanda saem na proporcao do item", () => {
    // corte R$ 60 + pomada R$ 40 = R$ 100; desconto R$ 10 -> corte vale R$ 54
    expect(valorCobradoItem(6000, { subtotal: 10000, desconto: 1000, estornado: 0 })).toBe(5400);
    // + estorno de R$ 45 do total de R$ 90 -> sobra metade: corte R$ 27
    expect(valorCobradoItem(6000, { subtotal: 10000, desconto: 1000, estornado: 4500 })).toBe(2700);
    expect(valorCobradoItem(6000, { subtotal: 6000, desconto: 0, estornado: 6000 })).toBe(0);
    expect(valorCobradoItem(6000, { subtotal: 6000, desconto: 9000, estornado: 0 })).toBe(0);
    expect(valorCobradoItem(0, { subtotal: 0, desconto: 0, estornado: 0 })).toBe(0);
  });
  it("percentual arredonda para o centavo", () => {
    expect(calcularComissao({ ...geral, avulsoValor: 3333 }, { modalidade: "AVULSO", preco: 4590, precoTabela: 0 }).comissao).toBe(1530);
  });
  it("resumo por barbeiro: avulso, plano, total e sem regra", () => {
    const r = resumirComissoes([
      { id: "1", barbeiroId: "pedro", servicoId: "corte", preco: 5000, precoTabela: 5000, plano: false, dia: "2026-10-01" },
      { id: "2", barbeiroId: "pedro", servicoId: "corte", preco: 0, precoTabela: 5000, plano: true, dia: "2026-10-01" },
      { id: "3", barbeiroId: "pedro", servicoId: "barba", preco: 3000, precoTabela: 3000, plano: false, dia: "2026-10-01" },
      { id: "4", barbeiroId: "joao", servicoId: "corte", preco: 6000, precoTabela: 5000, plano: false, dia: "2026-10-01" },
    ], [geral, excecao]);
    const pedro = r.find((x) => x.barbeiroId === "pedro")!;
    expect(pedro.avulso).toEqual({ qtd: 2, base: 8000, comissao: 2000, adicional: 0 });
    expect(pedro.plano).toEqual({ qtd: 1, base: 5000, comissao: 1500, adicional: 0 });
    expect(pedro.total).toBe(3500);
    expect(pedro.semRegra).toBe(1);
    expect(r.find((x) => x.barbeiroId === "joao")!.total).toBe(3000);
  });
  it("adicional de avulso vale so nos dias da vigencia", () => {
    const adic: Adicional[] = [{ barbeiroId: "pedro", modalidade: "AVULSO", pontosBps: 500, inicio: "2026-10-10", fim: "2026-10-20" }];
    const at = (id: string, dia: string) => ({ id, barbeiroId: "pedro", servicoId: "corte", preco: 10000, precoTabela: 10000, plano: false, dia });
    const r = resumirComissoes([at("1", "2026-10-09"), at("2", "2026-10-10"), at("3", "2026-10-20"), at("4", "2026-10-21")], [geral], { adicionais: adic })[0];
    expect(r.avulso).toEqual({ qtd: 4, base: 40000, comissao: 4000 + 4500 + 4500 + 4000, adicional: 1000 });
  });
});

describe("comissão diferenciada", () => {
  const adic: Adicional[] = [
    { barbeiroId: "ana", modalidade: "ASSINATURA", pontosBps: 500, inicio: "2026-10-01", fim: null },
    { barbeiroId: "ana", modalidade: "AVULSO", pontosBps: 200, inicio: "2026-10-01", fim: "2026-10-15" },
  ];
  it("pontos por modalidade e vigencia (fim inclusive, sem fim = para sempre)", () => {
    expect(adicionalNoDia(adic, "ana", "ASSINATURA", "2026-09-30")).toBe(0);
    expect(adicionalNoDia(adic, "ana", "ASSINATURA", "2027-01-01")).toBe(500);
    expect(adicionalNoDia(adic, "ana", "AVULSO", "2026-10-15")).toBe(200);
    expect(adicionalNoDia(adic, "ana", "AVULSO", "2026-10-16")).toBe(0);
    expect(adicionalNoDia(adic, "ygor", "ASSINATURA", "2026-10-05")).toBe(0);
  });
  it("periodos que se cruzam e folha fechada no periodo", () => {
    expect(periodosSeCruzam({ inicio: "2026-10-01", fim: null }, { inicio: "2030-01-01", fim: "2030-01-02" })).toBe(true);
    expect(periodosSeCruzam({ inicio: "2026-10-01", fim: "2026-10-31" }, { inicio: "2026-11-01", fim: null })).toBe(false);
    expect(competenciaFechadaNoPeriodo(["2026-08", "2026-09"], { inicio: "2026-09-15", fim: null })).toBe("2026-09");
    expect(competenciaFechadaNoPeriodo(["2026-09"], { inicio: "2026-10-01", fim: null })).toBeNull();
    expect(competenciaFechadaNoPeriodo(["2026-09"], { inicio: "2026-08-01", fim: "2026-08-31" })).toBeNull();
  });
});

describe("comissão das assinaturas", () => {
  const cfg = { percentualBps: 3500, creditos: { corte: 40, barba: 20 } };
  const at = (barbeiroId: string, servicoId: string, dia = "2026-10-10") => ({ barbeiroId, servicoId, dia });
  it("exemplo do dono: R$ 20.000 distribuíveis, 400 créditos, barbeiro com 80 créditos e 35%", () => {
    // 10 atendimentos de 40 créditos = 400; o barbeiro fez 2 (80 créditos)
    const ags = [...Array(8)].map(() => at("outro", "corte")).concat([at("pedro", "corte"), at("pedro", "corte")]);
    const r = calcularAssinaturas(cfg, { recebidoCentavos: 2000000, estornosCentavos: 0 }, ags);
    expect(r).toMatchObject({ distribuivelCentavos: 2000000, creditosTotal: 400, valorCreditoCentavos: 5000, percentualBaseBps: 3500 });
    expect(r.barbeiros.find((b) => b.barbeiroId === "pedro")).toEqual({
      barbeiroId: "pedro", qtd: 2, creditos: 80, receitaAtribuida: 400000, percentualBaseBps: 3500, adicionalBps: 0, comissaoBase: 140000, adicionalCentavos: 0, comissao: 140000,
    });
  });
  it("+5 pontos: R$ 1.400 vira R$ 1.600 e a parte dos outros não muda", () => {
    const ags = [...Array(8)].map(() => at("outro", "corte")).concat([at("pedro", "corte"), at("pedro", "corte")]);
    const adic: Adicional[] = [{ barbeiroId: "pedro", modalidade: "ASSINATURA", pontosBps: 500, inicio: "2026-01-01", fim: null }];
    const r = calcularAssinaturas(cfg, { recebidoCentavos: 2000000, estornosCentavos: 0 }, ags, adic);
    expect(r.barbeiros.find((b) => b.barbeiroId === "pedro")).toMatchObject({ adicionalBps: 500, comissaoBase: 140000, adicionalCentavos: 20000, comissao: 160000 });
    expect(r.barbeiros.find((b) => b.barbeiroId === "outro")!.comissao).toBe(560000); // 320 créditos x R$ 50 x 35%
  });
  it("estornos saem da receita; serviço sem crédito não entra; adicional muda no meio do período", () => {
    const adic: Adicional[] = [{ barbeiroId: "pedro", modalidade: "ASSINATURA", pontosBps: 500, inicio: "2026-10-15", fim: null }];
    const r = calcularAssinaturas(cfg, { recebidoCentavos: 110000, estornosCentavos: 10000 },
      [at("pedro", "corte", "2026-10-10"), at("pedro", "corte", "2026-10-20"), at("pedro", "sobrancelha"), at("joao", "barba")], adic);
    expect(r.distribuivelCentavos).toBe(100000);
    expect(r.creditosTotal).toBe(100);
    const pedro = r.barbeiros.find((b) => b.barbeiroId === "pedro")!;
    expect(pedro).toMatchObject({ qtd: 2, creditos: 80, receitaAtribuida: 80000, adicionalBps: 250, comissaoBase: 28000, comissao: 30000 });
    expect(calcularAssinaturas(cfg, { recebidoCentavos: 5000, estornosCentavos: 9000 }, [at("pedro", "corte")]).distribuivelCentavos).toBe(0);
  });
  it("sem atendimentos de plano com crédito, ninguém recebe", () => {
    expect(calcularAssinaturas(cfg, { recebidoCentavos: 100000, estornosCentavos: 0 }, [at("pedro", "sobrancelha")]).barbeiros).toEqual([]);
  });
  it("ligada: atendimento pelo plano fica zero no resumo e não conta como sem regra", () => {
    const r = resumirComissoes([{ id: "1", barbeiroId: "pedro", servicoId: "barba", preco: 0, precoTabela: 5000, plano: true, dia: "2026-10-01" }], [geral], { planoPeloPote: true })[0];
    expect(r.plano).toEqual({ qtd: 1, base: 5000, comissao: 0, adicional: 0 });
    expect(r.semRegra).toBe(0);
    expect(r.detalhe[0].regra).toBe("Comissão das assinaturas");
  });
});

describe("comissão de produtos", () => {
  const faixas: FaixaProduto[] = [
    { categoria: "LOJA", minimoCentavos: 10000, percentualBps: 500 }, { categoria: "LOJA", minimoCentavos: 40000, percentualBps: 1000 },
    { categoria: "LOJA", minimoCentavos: 100000, percentualBps: 1400 }, { categoria: "BAR", minimoCentavos: 10000, percentualBps: 100 },
  ];
  it("vale a maior faixa alcançada", () => {
    expect(faixaAlcancada(faixas, "LOJA", 9999)).toBeNull();
    expect(faixaAlcancada(faixas, "LOJA", 40000)?.percentualBps).toBe(1000);
    expect(faixaAlcancada(faixas, "LOJA", 250000)?.percentualBps).toBe(1400);
  });
  it("% da faixa sobre tudo o que vendeu, por categoria", () => {
    const r = comissaoProdutos([
      { barbeiroId: "pedro", categoria: "LOJA", valorCentavos: 30000 }, { barbeiroId: "pedro", categoria: "LOJA", valorCentavos: 15000 },
      { barbeiroId: "pedro", categoria: "BAR", valorCentavos: 8000 }, { barbeiroId: "joao", categoria: "BAR", valorCentavos: 12000 },
    ], faixas);
    expect(r.get("pedro")).toEqual({ vendido: 53000, comissao: 4500, categorias: [
      { categoria: "LOJA", vendido: 45000, percentualBps: 1000, comissao: 4500 }, { categoria: "BAR", vendido: 8000, percentualBps: 0, comissao: 0 },
    ] });
    expect(r.get("joao")!.comissao).toBe(120);
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
