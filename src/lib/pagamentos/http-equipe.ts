import type { z } from "zod";
import { urlPainel } from "@/lib/dominios";
import { proibido } from "@/lib/erros";
import { json } from "@/lib/estudio/http";

/** Mesma origem do painel e JSON limitado a 32 KiB, como a preparação de lote Pix. */
export async function corpoCobrancaEquipe<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  const origem = req.headers.get("origin");
  if (req.headers.get("sec-fetch-site") === "cross-site" || (origem && origem !== new URL(urlPainel()).origin)) throw proibido();
  return json(req, schema);
}
