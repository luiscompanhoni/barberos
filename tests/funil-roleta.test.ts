import { describe, expect, it } from "vitest";
import { montarFunilRoleta } from "@/lib/jogos/funil-roleta";

const instante = (minutos: number) => new Date(minutos * 60_000);
const linha = {
  clienteId: "cliente-a", ganhouEm: null, semContinuidadeEm: null, nudgeEnviadoEm: null, respondeuEm: null,
  agendouEm: null, lembreteEnviadoEm: null, compareceuEm: null, posEnviadoEm: null, upsellEnviadoEm: null, upsellAceitoEm: null,
};

describe("funil da roleta", () => {
  it("mantém a base de cada caminho e reconhece comparecimento sem lembrete", () => {
    const ganhouEm = instante(1);
    const semContinuidadeEm = instante(60);
    const nudgeEnviadoEm = instante(61);
    const respondeuEm = instante(62);
    const funil = montarFunilRoleta([
      linha,
      { ...linha, ganhouEm, agendouEm: instante(5), compareceuEm: instante(100), posEnviadoEm: instante(200) },
      { ...linha, clienteId: "cliente-b", ganhouEm, semContinuidadeEm },
      { ...linha, clienteId: "cliente-c", ganhouEm, semContinuidadeEm, nudgeEnviadoEm, respondeuEm, agendouEm: instante(63),
        compareceuEm: instante(100), posEnviadoEm: instante(200), upsellEnviadoEm: instante(201), upsellAceitoEm: instante(202) },
      { ...linha, clienteId: "cliente-d", ganhouEm, semContinuidadeEm, nudgeEnviadoEm, respondeuEm, agendouEm: instante(61) },
    ]);
    expect(funil).toMatchObject({ giros: 5, clientes: 4 });
    expect(funil.geral.map(e => [e.quantidade, e.base, e.perdas])).toEqual([[4, 5, 1], [3, 4, 1], [0, 3, 3], [2, 3, 1], [2, 2, 0]]);
    expect(funil.direto[0]).toMatchObject({ quantidade: 1, base: 4, conversao: 0.25 });
    expect(funil.assistido.map(e => [e.quantidade, e.base])).toEqual([[3, 4], [2, 3], [2, 2], [1, 2], [1, 2], [0, 2], [1, 2], [1, 1]]);
    expect(funil.direto.slice(1).map(e => e.quantidade)).toEqual([0, 1, 1]);
    expect(funil.upsell.map(e => [e.quantidade, e.base])).toEqual([[1, 2], [1, 1]]);
  });

  it("deixa a conversão indefinida se não houve nenhuma jogada", () => {
    expect(montarFunilRoleta([]).geral[0]).toMatchObject({ quantidade: 0, perdas: 0, conversao: null });
  });
});
