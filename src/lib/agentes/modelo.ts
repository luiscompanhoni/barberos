import { MODELO_PADRAO, modeloAnthropic, type Modelo } from "@/lib/bot/agente";
import { ErroNegocio } from "@/lib/erros";
import { obterAgente } from "./catalogo";
import { promptAgente } from "./prompts";
import { conferirResultado } from "./regras";
import type { ContextoAgente } from "./contexto";

export type ConsumoAgente = { modelo: string; tokensEntrada: number; tokensSaida: number };
export class FalhaResultadoAgente extends ErroNegocio {
  constructor(mensagem: string, codigo: string, readonly consumo: ConsumoAgente) { super(mensagem, 422, codigo); }
}

export async function produzirResultado(agenteId: string, tarefa: string, contexto: ContextoAgente, modelo: Modelo = modeloAnthropic) {
  const agente = obterAgente(agenteId);
  const entrada = JSON.stringify({ tarefa, contexto });
  if (Buffer.byteLength(entrada) > 100_000) throw new ErroNegocio("Contexto grande demais. Reduza o período ou divida a tarefa.", 422, "contexto_grande");
  const r = await modelo.criar({
    model: MODELO_PADRAO, max_tokens: 6000,
    system: promptAgente(agente.id),
    messages: [{ role: "user", content: [{ type: "text", text: entrada }] }],
  }, { signal: AbortSignal.timeout(120_000), maxRetries: 0 });
  const consumo = { modelo: MODELO_PADRAO, tokensEntrada: r.usage.input_tokens, tokensSaida: r.usage.output_tokens };
  try {
    if (r.stop_reason !== "end_turn") throw new ErroNegocio("O modelo não concluiu a tarefa. Nenhuma ação foi executada.", 422, "modelo_incompleto");
    const texto = r.content.filter(b => b.type === "text").map(b => b.text).join("\n").trim();
    let valor: unknown;
    try { valor = JSON.parse(texto); } catch { throw new ErroNegocio("Resposta fora do formato esperado. Revise ou repita a tarefa.", 422, "modelo_formato"); }
    return { resultado: conferirResultado(agenteId, valor), ...consumo };
  } catch (e) {
    // Uma resposta rejeitada já consumiu tokens. Não inclui conteúdo inválido no erro/auditoria.
    throw new FalhaResultadoAgente(e instanceof ErroNegocio ? e.message : "Resposta fora do formato esperado. Revise ou repita a tarefa.", e instanceof ErroNegocio ? e.codigo ?? "modelo_formato" : "modelo_formato", consumo);
  }
}
