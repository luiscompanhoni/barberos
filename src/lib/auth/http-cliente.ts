import type { z } from "zod";
import { urlPainel, urlSite } from "@/lib/dominios";
import { ErroNegocio } from "@/lib/erros";
import { json } from "@/lib/estudio/http";

function exigirOrigem(req: Request, permitidas: string[]) {
  const origin = req.headers.get("origin");
  if (req.headers.get("sec-fetch-site") === "cross-site" || (origin !== null && !permitidas.includes(origin))) {
    throw new ErroNegocio("Origem da solicitação inválida.", 403);
  }
}

export function exigirOrigemCliente(req: Request) {
  exigirOrigem(req, [new URL(urlSite()).origin]);
}

/** Login e senha são compartilhados pelos endereços do cliente e da equipe. */
export function exigirOrigemAutenticacao(req: Request) {
  exigirOrigem(req, [new URL(urlSite()).origin, new URL(urlPainel()).origin]);
}

export async function corpoAutenticacao<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  exigirOrigemAutenticacao(req);
  // Formulário cross-site text/plain também pode conter JSON válido; não é nosso contrato.
  if (req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new ErroNegocio("Envie os dados como JSON.", 415);
  }
  return json(req, schema);
}
