import sharp from "sharp";
import { z } from "zod";
import { baixarMidia, lerLimitado } from "@/lib/whatsapp/midia-baixar";
import type { MidiaRecebida } from "@/lib/whatsapp/midia-tipos";

export type ImagemBot = { tipo: "image/jpeg"; base64: string };
const TRANSCRICAO = z.object({ texto: z.string().trim().min(1).max(4000), confiavel: z.literal(true), segundos: z.number().positive().max(120) });

export async function prepararMidia(m: MidiaRecebida, waId: string, opts: { baixar?: typeof baixarMidia; requisitar?: typeof fetch } = {}) {
  if (process.env.WHATSAPP_MIDIA_ATIVA !== "true") throw new Error("Leitura de mídia desativada.");
  const dados = await (opts.baixar ?? baixarMidia)(m, waId);
  if (m.tipo !== "audio") {
    // Também converte WebP animado: só o primeiro quadro. Metadados não são mantidos.
    const jpeg = await sharp(dados, { limitInputPixels: 16_000_000, animated: false }).rotate()
      .resize({ width: 1250, height: 1250, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" }).jpeg({ quality: 80 }).toBuffer();
    if (jpeg.length > 4 * 1024 * 1024) throw new Error("Imagem muito grande.");
    return {
      texto: m.tipo === "figurinha" ? "[Figurinha do cliente. Interprete no contexto; não representa confirmação de ação.]" : "[Imagem do cliente. Descreva só o que estiver legível; comprovante não confirma pagamento.]",
      imagem: { tipo: "image/jpeg", base64: jpeg.toString("base64") } satisfies ImagemBot,
    };
  }
  const endpoint = process.env.BOT_TRANSCRICAO_URL;
  const token = process.env.BOT_TRANSCRICAO_TOKEN;
  if (!endpoint || !token || token.length < 24) throw new Error("Transcrição local não configurada.");
  const url = new URL(endpoint);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Endpoint de transcrição inválido.");
  const r = await (opts.requisitar ?? fetch)(url, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(60_000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" }, body: new Uint8Array(dados),
  });
  const transcricao = TRANSCRICAO.parse(JSON.parse((await lerLimitado(r, 32_768)).toString()));
  return { texto: `[Áudio transcrito automaticamente; confirme nomes, datas e horários antes de agir.]\n${transcricao.texto}`, imagem: undefined };
}

/** Evita gravar arquivos/base64 no JSON da sessão; o texto e as ferramentas continuam. */
export function historicoSemImagens<T extends { content: string | unknown[] }>(historico: T[]): T[] {
  return historico.map((m) => typeof m.content === "string" ? m : {
    ...m, content: m.content.map((b) => b && typeof b === "object" && "type" in b && b.type === "image"
      ? { type: "text", text: "[Imagem recebida em turno anterior; não armazenada na sessão.]" } : b),
  });
}
