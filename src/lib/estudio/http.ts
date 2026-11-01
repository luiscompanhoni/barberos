import { timingSafeEqual } from "node:crypto";
import type { z } from "zod";
import { urlPainel } from "@/lib/dominios";
import { exigirSessao } from "@/lib/auth/sessao";
import { ErroNegocio } from "@/lib/erros";

export function habilitado() { return process.env.ESTUDIO_HABILITADO === "true"; }
export function exigirHabilitado() { if (!habilitado()) throw new ErroNegocio("Estúdio ainda não habilitado neste ambiente.", 503); }
export async function equipe(req?: Request) {
  exigirHabilitado();
  const s = await exigirSessao();
  // Mesmo site, inclusive uploads binários que não passam por Server Actions.
  if (req && !["GET", "HEAD"].includes(req.method)) {
    const origin = req.headers.get("origin");
    const permitida = new URL(urlPainel()).origin;
    if (req.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== permitida)) throw new ErroNegocio("Origem da solicitação inválida.", 403);
  }
  return s;
}
export function exigirWorker(req: Request) {
  exigirHabilitado();
  const token = process.env.ESTUDIO_WORKER_TOKEN || "";
  const enviado = req.headers.get("authorization") || "";
  const esperado = "Bearer " + token;
  if (token.length < 32 || Buffer.byteLength(enviado) !== Buffer.byteLength(esperado) || !timingSafeEqual(Buffer.from(enviado), Buffer.from(esperado))) throw new ErroNegocio("Processador não autorizado.", 401);
}
export async function json<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  if (!req.body) throw new ErroNegocio("Dados ausentes.", 400);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 32_768) { await reader.cancel(); throw new ErroNegocio("Dados acima do limite.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new ErroNegocio("JSON inválido.", 400); }
  return schema.parse(body);
}
export function resposta(dados: unknown, status = 200) { return Response.json(dados, { status, headers: { "Cache-Control": "private, no-store" } }); }
