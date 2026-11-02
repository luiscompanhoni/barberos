import { describe, expect, it } from "vitest";
import type { Modelo } from "@/lib/bot/agente";
import { produzirResultado } from "@/lib/agentes/modelo";
const contexto = { fontes: [], integracoes: [], limites: [], anterior: null };
function modelo(texto: string, stop = "end_turn"): Modelo {
  return { criar: async (params, opcoes) => {
    expect(params.tools).toBeUndefined();
    expect(opcoes?.maxRetries).toBe(0);
    expect(opcoes?.signal).toBeDefined();
    return { stop_reason: stop, content: [{ type: "text", text: texto }], usage: { input_tokens: 10, output_tokens: 20 } } as Awaited<ReturnType<Modelo["criar"]>>;
  } };
}
describe("saída de agentes", () => {
  it("retorna rascunho estruturado e uso sem ferramentas externas", async () => {
    const resultado = { resumo: "Plano local", entregaveis: ["Criar roteiro"], alertas: ["Mídia ainda não gerada"], proximosPassos: [] };
    const r = await produzirResultado("conteudo", "Preparar um roteiro da Black", contexto, modelo(JSON.stringify(resultado)));
    expect(r.resultado).toEqual(resultado); expect(r.tokensEntrada).toBe(10);
  });
  it("recusa resposta truncada ou não estruturada", async () => {
    await expect(produzirResultado("conteudo", "Preparar um roteiro da Black", contexto, modelo("feito"))).rejects.toThrow(/formato/);
    await expect(produzirResultado("conteudo", "Preparar um roteiro da Black", contexto, modelo("{}", "max_tokens"))).rejects.toThrow(/concluiu/);
  });
  it("preserva consumo conhecido em respostas inválidas sem incluir seu conteúdo", async () => {
    for (const [texto, stop] of [["SEGREDO_INVALIDO", "end_turn"], ["{}", "max_tokens"], ['{"invalido":"SEGREDO_INVALIDO"}', "end_turn"]]) {
      const erro = await produzirResultado("conteudo", "Preparar um roteiro da Black", contexto, modelo(texto, stop)).catch(e => e);
      expect(erro.consumo).toMatchObject({ tokensEntrada: 10, tokensSaida: 20 });
      expect(erro.message).not.toContain("SEGREDO_INVALIDO");
    }
  });
  it("limita contexto antes de chamar o provedor", async () => {
    let chamou = false;
    const fake: Modelo = { criar: async () => { chamou = true; throw new Error("não deve chamar"); } };
    await expect(produzirResultado("conteudo", "x".repeat(110_000), contexto, fake)).rejects.toThrow(/grande/);
    expect(chamou).toBe(false);
  });
});
