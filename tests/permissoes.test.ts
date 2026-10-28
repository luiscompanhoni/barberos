import { describe, expect, it } from "vitest";
import { aplicarPermissoesIndividuais, CHAVES, configuravel, linhasParaSalvar, permissoesDoPapel } from "@/lib/auth/permissoes-regras";

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
  it("gerente ve o faturamento por padrao; lucro, estorno, folha e exclusao so se o dono ligar", () => {
    expect(permissoesDoPapel("GERENTE", [])).toMatchObject({ resultado: true, lucro: false, desconto: true, caixa: true, estorno: false, folha: false, comissao: false, excluir: false });
    expect(permissoesDoPapel("GERENTE", [{ papel: "GERENTE", permissao: "lucro", permitido: true }]).lucro).toBe(true);
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

describe("liderança e permissões individuais", () => {
  it("líder acessa reuniões e avalia equipe sem ganhar folha, lucro ou comissões de terceiros", () => {
    expect(permissoesDoPapel("LIDER", [])).toMatchObject({ reunioes: true, avaliar_equipe: true, lucro: false, comissoes_equipe: false, folha: false, caixa: false });
  });
  it("reuniões não podem ser liberadas a barbeiros nem recepção", () => {
    for (const papel of ["BARBEIRO", "RECEPCAO"] as const) {
      expect(permissoesDoPapel(papel, [{ papel, permissao: "reunioes", permitido: true }]).reunioes).toBe(false);
    }
  });
  it("exceção individual revoga bloqueio sem alterar outras permissões", () => {
    const base = permissoesDoPapel("BARBEIRO", []);
    const p = aplicarPermissoesIndividuais("BARBEIRO", base, [{ permissao: "bloquear_agenda", permitido: false }]);
    expect(p.bloquear_agenda).toBe(false);
    expect(base.bloquear_agenda).toBe(true);
    expect(p.duracao).toBe(true);
  });
  it("exceção individual não burla limites do papel nem limita dono", () => {
    expect(aplicarPermissoesIndividuais("BARBEIRO", permissoesDoPapel("BARBEIRO", []), [{ permissao: "lucro", permitido: true }]).lucro).toBe(false);
    expect(aplicarPermissoesIndividuais("DONO", permissoesDoPapel("DONO", []), [{ permissao: "reunioes", permitido: false }]).reunioes).toBe(true);
  });
});
