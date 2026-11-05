import type { z } from "zod";
import { urlPainel, urlSite } from "@/lib/dominios";
import { ErroNegocio, proibido } from "@/lib/erros";
import { json } from "@/lib/estudio/http";

export function exigirOrigemAssinatura(req: Request) {
  const origem = req.headers.get("origin");
  if (req.headers.get("sec-fetch-site") === "cross-site" || (origem && ![new URL(urlSite()).origin, new URL(urlPainel()).origin].includes(origem))) throw proibido();
}

export async function corpoAssinatura<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  exigirOrigemAssinatura(req);
  if (Number(req.headers.get("content-length")) > 32_768) throw new ErroNegocio("Dados acima do limite.", 413);
  return json(req, schema);
}
