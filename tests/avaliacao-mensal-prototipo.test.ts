import { describe, expect, it } from "vitest";
import { simularResumoMensal } from "../scripts/prototipos/avaliacoes-resumo-mensal";

const agora = Date.parse("2026-12-02T15:00:00Z");
const entrada = { competencia: "2026-11", profissionais: ["b1", "b2"], votos: Array.from({ length: 4 }, () => ({ profissionalId: "b1", estrelas: 5 })) };
describe("protótipo isolado de resumo mensal", () => {
  it("suprime da mesma maneira zero ou quatro respostas, sem mostrar contagem ou soma", () => {
    expect(simularResumoMensal(entrada, agora)).toEqual([
      { profissionalId: "b1", competencia: "2026-11", media: null },
      { profissionalId: "b2", competencia: "2026-11", media: null },
    ]);
  });
  it("agrega apenas quando o grupo atinge o limiar de estudo", () => {
    const votos = [...entrada.votos, { profissionalId: "b1", estrelas: 3 }];
    expect(simularResumoMensal({ ...entrada, votos }, agora)[0]).toEqual({ profissionalId: "b1", competencia: "2026-11", media: 4.6 });
  });
  it("não resume meses correntes e não aceita profissionais inexistentes", () => {
    expect(() => simularResumoMensal({ ...entrada, competencia: "2026-12" }, agora)).toThrow();
    expect(() => simularResumoMensal({ ...entrada, votos: [{ profissionalId: "b3", estrelas: 3 }] }, agora)).toThrow();
  });
  it.each([{ clienteId: "cliente" }, { comentario: "fui na terça" }, { enviadoEm: "2026-11-02" }, { token: "a" }])("rejeita informação correlacionável adicional %#", extra => {
    expect(() => simularResumoMensal({ ...entrada, votos: [{ profissionalId: "b1", estrelas: 5, ...extra }] }, agora)).toThrow();
  });
});
