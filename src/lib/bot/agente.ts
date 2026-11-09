import Anthropic from "@anthropic-ai/sdk";
import type { ImagemBot } from "./multimodal";
import { executarFerramenta, FERRAMENTAS, type ContextoBot, type ResultadoFerramenta } from "./ferramentas";

type Msg = Anthropic.Beta.BetaMessageParam;
type Params = Anthropic.Beta.MessageCreateParamsNonStreaming;

/** Interface minima do modelo (permite testar o loop com um modelo falso). */
export type Modelo = { criar(params: Params, opcoes?: { signal?: AbortSignal; maxRetries?: number }): Promise<Anthropic.Beta.BetaMessage> };

export const MODELO_PADRAO = process.env.BOT_MODELO ?? "claude-opus-5-5";
const MAX_VOLTAS = 8;

/** Modelos da familia atual aceitam effort e fallback de recusa no servidor. */
function extrasDoModelo(modelo: string): Partial<Params> {
  if (/^claude-(opus-5|fable-5|sonnet-5-5)/.test(modelo)) {
    return {
      output_config: { effort: "low" }, // conversa de atendimento: respostas rapidas e baratas
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    };
  }
  return {};
}

let clienteAnthropic: Anthropic | null = null;
export const modeloAnthropic: Modelo = {
  criar: (params, opcoes) => {
    clienteAnthropic ??= new Anthropic();
    return clienteAnthropic.beta.messages.create(params, opcoes);
  },
};

export type ResultadoTurno = {
  resposta: string;
  /** Historico da sessao depois do turno (so cresce: o que foi enviado nao e reescrito). */
  historico: Msg[];
  passouParaHumano: boolean;
  recusado: boolean;
  ferramentas: string[];
  interrompido?: boolean;
};

/**
 * Um turno do cliente: envia a mensagem, executa as ferramentas pedidas pelo
 * modelo e devolve o texto final para mandar no WhatsApp.
 */
export async function executarTurno(p: {
  sistema: string;
  historico: Msg[];
  contexto: string;
  texto: string;
  imagem?: ImagemBot;
  /** Imagem/figurinha sem texto não autoriza efeitos operacionais. */
  somenteConsulta?: boolean;
  /** Recepção pode assumir enquanto download/modelo está em andamento. */
  podeContinuar?: () => Promise<boolean>;
  ctx: ContextoBot;
  modelo?: Modelo;
  nomeModelo?: string;
  executor?: (nome: string, entrada: unknown, ctx: ContextoBot) => Promise<ResultadoFerramenta>;
}): Promise<ResultadoTurno> {
  const modelo = p.modelo ?? modeloAnthropic;
  const nomeModelo = p.nomeModelo ?? MODELO_PADRAO;
  const executor = p.executor ?? executarFerramenta;
  const historico: Msg[] = [
    ...p.historico,
    { role: "user", content: [
      { type: "text", text: p.contexto }, { type: "text", text: p.texto },
      ...(p.imagem ? [{ type: "image" as const, source: { type: "base64" as const, media_type: p.imagem.tipo, data: p.imagem.base64 } }] : []),
    ] },
  ];
  const usadas: string[] = [];
  let passouParaHumano = false;

  for (let volta = 0; volta < MAX_VOLTAS; volta++) {
    if (!passouParaHumano && p.podeContinuar && !await p.podeContinuar()) return { resposta: "", historico: p.historico, passouParaHumano: true, recusado: false, ferramentas: usadas, interrompido: true };
    const r = await modelo.criar({
      model: nomeModelo,
      max_tokens: 8000,
      system: [{ type: "text", text: p.sistema }],
      tools: FERRAMENTAS,
      messages: historico,
      cache_control: { type: "ephemeral" }, // cacheia o prefixo (ferramentas + sistema + conversa)
      ...extrasDoModelo(nomeModelo),
    });

    if (r.stop_reason === "refusal") {
      return { resposta: "", historico: p.historico, passouParaHumano: false, recusado: true, ferramentas: usadas };
    }

    historico.push({ role: "assistant", content: r.content }); // conteudo inteiro, sem editar

    if (r.stop_reason === "pause_turn") continue;

    const chamadas = r.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (r.stop_reason !== "tool_use" || !chamadas.length) {
      const texto = r.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { resposta: texto, historico, passouParaHumano, recusado: false, ferramentas: usadas };
    }

    // Todas as respostas das ferramentas voltam numa unica mensagem.
    const resultados: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const c of chamadas) {
      if (!passouParaHumano && p.podeContinuar && !await p.podeContinuar()) return { resposta: "", historico: p.historico, passouParaHumano: true, recusado: false, ferramentas: usadas, interrompido: true };
      usadas.push(c.name);
      const consulta = ["listar_servicos", "consultar_horarios", "meus_agendamentos", "listar_planos", "minha_assinatura", "meus_presentes", "oferta_cancelamento", "chamar_atendente"].includes(c.name);
      const res: ResultadoFerramenta = passouParaHumano
        ? { texto: "A equipe assumiu. Não execute mais ações nesta conversa.", erro: true }
        : p.somenteConsulta && !consulta
          ? { texto: "Imagem ou figurinha sem texto não autoriza esta ação. Peça confirmação explícita em texto com os detalhes.", erro: true }
          : await executor(c.name, c.input, p.ctx);
      if (res.passouParaHumano) passouParaHumano = true;
      resultados.push({ type: "tool_result", tool_use_id: c.id, content: res.texto, is_error: res.erro || undefined });
    }
    historico.push({ role: "user", content: resultados });
    if (passouParaHumano) {
      // A transferência já ocorreu. Não chamar novamente o modelo para inventar
      // prazo, reabrir venda ou atrasar a entrada da recepção.
      return { resposta: "Pedi para a equipe continuar por aqui.", historico, passouParaHumano: true, recusado: false, ferramentas: usadas };
    }
  }

  return {
    resposta: "Desculpe, me enrolei aqui. Vou chamar alguém da equipe para te ajudar.",
    historico,
    passouParaHumano: true,
    recusado: false,
    ferramentas: usadas,
  };
}
