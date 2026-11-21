import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { historicoSemImagens } from "./multimodal";

export function historicoEntregue(historico: Anthropic.Beta.BetaMessageParam[], resposta: string, enviadas: string[]) {
  const ultima = historico.at(-1);
  const blocos = ultima && Array.isArray(ultima.content) ? ultima.content : [];
  const texto = typeof ultima?.content === "string" ? ultima.content : blocos.filter(b => b.type === "text").map(b => b.text).join("\n").trim();
  // Texto final pendente não é fala entregue. Chamadas e resultados de ferramentas ficam intactos.
  const semPendente = ultima?.role === "assistant" && resposta && texto === resposta && !blocos.some(b => b.type === "tool_use") ? historico.slice(0, -1) : historico;
  return historicoSemImagens([...semPendente, ...(enviadas.length ? [{ role: "assistant" as const, content: enviadas.join("\n\n") }] : [])]);
}

export async function esperarBolha(atraso: number, sinal: AbortSignal) {
  if (sinal.aborted) return false;
  return new Promise<boolean>((resolve) => {
    const cancelar = () => { clearTimeout(timer); resolve(false); };
    const timer = setTimeout(() => { sinal.removeEventListener("abort", cancelar); resolve(!sinal.aborted); }, atraso);
    sinal.addEventListener("abort", cancelar, { once: true });
  });
}

/** Hora da mensagem anterior a atual (para saber se a sessao "esfriou"). */
export async function ultimaAtividade(conversaId: string) {
  const ultimas = await db.mensagem.findMany({ where: { conversaId }, orderBy: { criadoEm: "desc" }, take: 2, select: { criadoEm: true } });
  return (ultimas[1] ?? ultimas[0])?.criadoEm.getTime() ?? 0;
}
