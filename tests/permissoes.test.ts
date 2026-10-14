import { describe, expect, it } from "vitest";
import { CHAVES, configuravel, linhasParaSalvar, permissoesDoPapel } from "@/lib/auth/permissoes-regras";

describe("permissoes: padrao por papel", () => {
  it("dono pode tudo e cliente nada, com ou sem linhas salvas", () => {
    const tudoNegado = CHAVES.map((k) => ({ papel: "DONO" as const, permissao: k, permitido: false }));
    expect(Object.values(permissoesDoPapel("DONO", tudoNegado)).every(Boolean)).toBe(true);
    expect(Object.values(permissoesDoPapel("CLIENTE", [])).some(Boolean)).toBe(false);
  });
  it("padrao mantem o que ja era: recepcao da desconto e mexe no caixa, mas nao estorna nem ve resultado", () => {
    const r = permissoesDoPapel("RECEPCAO", []);
    expect(r).toMatchObject({ desconto: true, caixa: true, saldo: true, estorno: false, resultado: false, folha: false, excluir: false, assinatura: false });
  });
  it("gerente ve o resultado por padrao; estorno, folha e exclusao so se o dono ligar", () => {
    expect(permissoesDoPapel("GERENTE", [])).toMatchObject({ resultado: true, desconto: true, caixa: true, estorno: false, folha: false, comissao: false, excluir: false });
    expect(permissoesDoPapel("GERENTE", [{ papel: "GERENTE", permissao: "estorno", permitido: true }]).estorno).toBe(true);
  });
  it("barbeiro: so desconto e saldo sao configuraveis (linha salva para outra acao nao vale)", () => {
    expect(configuravel("BARBEIRO", "desconto")).toBe(true);
    expect(configuravel("BARBEIRO", "caixa")).toBe(false);
    const b = permissoesDoPapel("BARBEIRO", [{ papel: "BARBEIRO", permissao: "caixa", permitido: true }, { papel: "BARBEIRO", permissao: "desconto", permitido: true }]);
    expect(b).toMatchObject({ caixa: false, desconto: true, saldo: true });
  });
  it("linha de outro papel nao vaza", () => {
    expect(permissoesDoPapel("RECEPCAO", [{ papel: "GERENTE", permissao: "estorno", permitido: true }]).estorno).toBe(false);
  });
});

describe("permissoes: o que gravar", () => {
  it("so grava o que difere do padrao; igual ao padrao apaga a linha", () => {
    const { gravar, apagar } = linhasParaSalvar({ GERENTE: { estorno: true, desconto: true }, RECEPCAO: { caixa: false }, BARBEIRO: { caixa: true } });
    expect(gravar).toEqual([
      { papel: "GERENTE", permissao: "estorno", permitido: true },
      { papel: "RECEPCAO", permissao: "caixa", permitido: false },
    ]);
    expect(apagar).toEqual([{ papel: "GERENTE", permissao: "desconto" }]);
  });
});
