import { describe, expect, it } from "vitest";
import {
  codigoDoPremio, comandasComResgate, comBonus, custoEsperado, descontoDoPremio, elegiveis, fichasDevidas, gratisDevida, montarGrade,
  multiplicador, normalizarCodigo, raridadePelaChance, retornoPorReal, simular, sortear, trioDaGrade, validarPremios,
} from "@/lib/jogos/regras";
import { JOGOS_PADRAO, ROLETA_PADRAO } from "@/lib/jogos/padroes";

const p = (id: string, chanceBps: number, extra: Partial<{ ativo: boolean; limiteMensal: number | null; estoque: number | null }> = {}) =>
  ({ id, chanceBps, ativo: true, limiteMensal: null, estoque: null, ...extra });

/** Gerador deterministico (para testar embaralhamento sem depender da sorte). */
function semente(s: number) {
  return (max: number) => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s % max;
  };
}

describe("sorteio", () => {
  it("premio sem estoque, inativo, sem chance ou no limite do mes nao sai", () => {
    const ps = [p("a", 5000), p("b", 3000, { estoque: 0 }), p("c", 2000, { ativo: false }), p("d", 0), p("e", 1000, { limiteMensal: 2 }), p("f", 1000, { estoque: 3 })];
    expect(elegiveis(ps, new Map([["e", 2]])).map((x) => x.id)).toEqual(["a", "f"]);
  });

  it("escolhe pela faixa de chance e recusa sorteio fora da faixa", () => {
    const ps = [p("a", 7000), p("b", 3000)];
    expect(sortear(ps, 0).id).toBe("a");
    expect(sortear(ps, 6999).id).toBe("a");
    expect(sortear(ps, 7000).id).toBe("b");
    expect(sortear(ps, 9999).id).toBe("b");
    expect(() => sortear(ps, 10_000)).toThrow();
    expect(() => sortear(ps, -1)).toThrow();
    expect(() => sortear([], 0)).toThrow();
  });

  it("premio esgotado: os outros dividem a chance dele", () => {
    const ps = [p("a", 5000), p("b", 2500), p("c", 2500, { estoque: 0 })];
    const { conta } = simular(ps, 20_000, 1, semente(7));
    expect((conta.get("a")! / 20_000)).toBeCloseTo(2 / 3, 1);
    expect(conta.get("c")).toBe(0);
  });

  it("simulacao respeita o estoque (nao sai mais do que tem)", () => {
    const { conta } = simular([p("a", 9000, { estoque: 5 }), p("b", 1000)], 1000, 1, semente(3));
    expect(conta.get("a")).toBe(5);
    expect(conta.get("b")).toBe(995);
  });
});

describe("validacao das chances", () => {
  const base = { valorCentavos: 500, percentual: 0, servicoId: null };
  it("soma dos ativos precisa dar exatamente 100%", () => {
    const ok = [{ ...base, rotulo: "A", tipo: "CREDITO", chanceBps: 6000, ativo: true }, { ...base, rotulo: "B", tipo: "NADA", chanceBps: 4000, ativo: true }];
    expect(validarPremios("ROLETA", ok)).toEqual([]);
    const errado = [{ ...ok[0], chanceBps: 6001 }, ok[1]];
    expect(validarPremios("ROLETA", errado)[0]).toMatch(/100%.*100,01%/);
    // Inativo nao entra na soma.
    expect(validarPremios("ROLETA", [...ok, { ...base, rotulo: "C", tipo: "CREDITO", chanceBps: 5000, ativo: false }])).toEqual([]);
  });

  it("regras de cada jogo", () => {
    const um = [{ ...base, rotulo: "A", tipo: "CREDITO", chanceBps: 10_000, ativo: true }];
    expect(validarPremios("ROLETA", um).join()).toMatch(/2 fatias/);
    const comNada = [{ ...base, rotulo: "A", tipo: "CREDITO", chanceBps: 5000, ativo: true }, { ...base, rotulo: "N", tipo: "NADA", chanceBps: 5000, ativo: true }];
    expect(validarPremios("CAIXA", comNada).join()).toMatch(/Caixa sempre dá prêmio/);
    expect(validarPremios("RASPADINHA", [{ ...base, rotulo: "N", tipo: "NADA", chanceBps: 10_000, ativo: true }]).join()).toMatch(/prêmio de verdade/);
    expect(validarPremios("CAIXA", [{ ...base, rotulo: "S", tipo: "SERVICO", chanceBps: 10_000, ativo: true }]).join()).toMatch(/serviço/);
    expect(validarPremios("CAIXA", [{ ...base, rotulo: "D", tipo: "DESCONTO", chanceBps: 10_000, ativo: true }]).join()).toMatch(/desconto entre/);
  });

  it("jogos padrao ja nascem validos", () => {
    for (const j of [ROLETA_PADRAO, ...JOGOS_PADRAO]) {
      const ps = j.premios.map((x) => ({ ...x, ativo: true, valorCentavos: x.valorCentavos ?? 0, percentual: x.percentual ?? 0, servicoId: null }));
      expect(validarPremios(j.tipo, ps), j.id).toEqual([]);
    }
  });
});

describe("codigo do premio", () => {
  it("formato BB- com 6 caracteres sem ambiguidade", () => {
    const c = codigoDoPremio(new Uint8Array([0, 1, 2, 30, 31, 255]));
    expect(c).toMatch(/^BB-[2-9A-HJKMNP-Z]{6}$/);
    expect(c).not.toMatch(/[01ILO]/);
  });
  it("normaliza o que a recepcao digita", () => {
    expect(normalizarCodigo("bb 7k2q9m")).toBe("BB-7K2Q9M");
    expect(normalizarCodigo("7K2Q9M")).toBe("BB-7K2Q9M");
    expect(normalizarCodigo("BB-7K2")).toBeNull();
  });
});

describe("raspadinha", () => {
  const premios = [
    { simbolo: "a", rotulo: "R$ 5", icone: "dinheiro" },
    { simbolo: "b", rotulo: "Bebida", icone: "bebida" },
  ];
  it("vitoria: exatamente um trio, o do premio, e as casas certas", () => {
    for (let s = 1; s < 300; s++) {
      const { grade, vencedoras } = montarGrade(premios[0], premios, semente(s));
      expect(grade).toHaveLength(9);
      expect(trioDaGrade(grade)).toBe("a");
      expect(grade.filter((c) => c.simbolo === "a")).toHaveLength(3);
      expect(vencedoras).toHaveLength(3);
      for (const i of vencedoras) expect(grade[i].simbolo).toBe("a");
      const contagem = new Map<string, number>();
      for (const c of grade) contagem.set(c.simbolo, (contagem.get(c.simbolo) ?? 0) + 1);
      expect([...contagem.entries()].filter(([, n]) => n >= 3)).toHaveLength(1);
    }
  });
  it("derrota: nenhum simbolo 3 vezes (mesmo com poucos premios)", () => {
    for (let s = 1; s < 300; s++) {
      const { grade, vencedoras } = montarGrade(null, premios.slice(0, 1), semente(s));
      expect(grade).toHaveLength(9);
      expect(trioDaGrade(grade)).toBeNull();
      expect(vencedoras).toEqual([]);
    }
  });
});

describe("jogadas devidas", () => {
  const regras = { jogadasPorAtendimento: 2, valorMinimoAtendimentoCentavos: 8000, jogadasPorIndicacao: 1, jogadasAniversario: 1, jogadasRenovacaoPlano: 1 };
  const d = { atendimentos: [{ id: "ag1", valorCentavos: 9000 }, { id: "ag2", valorCentavos: 4000 }], indicacoes: ["ind1"], mensalidades: ["cob1"], nascimento: "1990-10-14", hoje: "2026-10-20", desde: "2026-01-01" };

  it("cada evento vira fichas com referencia unica", () => {
    expect(fichasDevidas(regras, d)).toEqual([
      { origem: "ATENDIMENTO", referencia: "ag1:1" }, { origem: "ATENDIMENTO", referencia: "ag1:2" },
      { origem: "INDICACAO", referencia: "ind1:1" }, { origem: "ASSINATURA", referencia: "cob1:1" },
      { origem: "ANIVERSARIO", referencia: "2026:1" },
    ]);
  });
  it("aniversario so do dia ate 30 dias depois, e nao antes do jogo ligar", () => {
    const so = (x: Partial<typeof d>) => fichasDevidas(regras, { ...d, ...x }).filter((f) => f.origem === "ANIVERSARIO");
    expect(so({ hoje: "2026-10-13" })).toEqual([]);
    expect(so({ hoje: "2026-11-12" })).toHaveLength(1);
    expect(so({ hoje: "2026-11-13" })).toEqual([]);
    expect(so({ desde: "2026-10-15" })).toEqual([]);
    expect(so({ nascimento: "2000-02-29", hoje: "2027-02-28" })).toHaveLength(1);
  });
  it("jogada gratis do periodo", () => {
    const agora = Date.UTC(2026, 9, 14);
    expect(gratisDevida(0, null, agora).devida).toBe(false);
    expect(gratisDevida(7, null, agora).devida).toBe(true);
    expect(gratisDevida(7, new Date(agora - 6 * 86_400_000), agora)).toMatchObject({ devida: false });
    expect(gratisDevida(7, new Date(agora - 7 * 86_400_000), agora).devida).toBe(true);
  });
});

describe("dinheiro", () => {
  it("bonus do assinante e custo esperado", () => {
    expect(multiplicador(true, 10)).toBe(110);
    expect(multiplicador(false, 10)).toBe(100);
    expect(comBonus(500, 110)).toBe(550);
    const ps = [
      { chanceBps: 5000, ativo: true, tipo: "CREDITO", valorCentavos: 1000, custoCentavos: 0 },
      { chanceBps: 5000, ativo: true, tipo: "BRINDE", valorCentavos: 0, custoCentavos: 400 },
    ];
    expect(custoEsperado(ps)).toBe(700);
    expect(custoEsperado(ps, 3)).toBe(2100);
  });
  it("desconto do premio na comanda (servico gratis e %)", () => {
    expect(descontoDoPremio({ tipo: "DESCONTO", percentual: 15, valorCentavos: 0 }, { podeDescontar: 6000, precoServico: null })).toBe(900);
    expect(descontoDoPremio({ tipo: "SERVICO", percentual: 0, valorCentavos: 0 }, { podeDescontar: 9000, precoServico: 4500 })).toBe(4500);
    expect(descontoDoPremio({ tipo: "SERVICO", percentual: 0, valorCentavos: 3000 }, { podeDescontar: 9000, precoServico: 4500 })).toBe(3000);
    expect(descontoDoPremio({ tipo: "SERVICO", percentual: 0, valorCentavos: 0 }, { podeDescontar: 2000, precoServico: 4500 })).toBe(2000);
    expect(descontoDoPremio({ tipo: "SERVICO", percentual: 0, valorCentavos: 0 }, { podeDescontar: 2000, precoServico: null })).toBe(0);
    expect(descontoDoPremio({ tipo: "DESCONTO", percentual: 50, valorCentavos: 0 }, { podeDescontar: 0, precoServico: null })).toBe(0);
  });
  it("visitas com resgate e retorno por real", () => {
    const cs = [{ id: "c1", clienteId: "x", dia: "2026-10-01" }, { id: "c2", clienteId: "y", dia: "2026-10-02" }, { id: "c3", clienteId: "z", dia: "2026-10-03" }];
    expect(comandasComResgate(cs, new Set(["c1"]), [{ clienteId: "y", dia: "2026-10-02" }]).map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(retornoPorReal(10_000, 2500)).toBe(4);
    expect(retornoPorReal(10_000, 0)).toBeNull();
  });
  it("raridade sugerida pela chance", () => {
    expect(raridadePelaChance(100, "CREDITO")).toBe("LENDARIO");
    expect(raridadePelaChance(500, "CREDITO")).toBe("EPICO");
    expect(raridadePelaChance(1000, "BRINDE")).toBe("RARO");
    expect(raridadePelaChance(3000, "CREDITO")).toBe("COMUM");
    expect(raridadePelaChance(50, "NADA")).toBe("COMUM");
  });
});
