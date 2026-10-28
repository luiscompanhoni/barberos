import { z } from "zod";
import { urlPainel, urlSite } from "@/lib/dominios";
import { ErroNegocio } from "@/lib/erros";

export function exigirOrigemNotificacoes(req: Request) {
  const origem = req.headers.get("origin");
  const permitidas = [new URL(urlSite()).origin, new URL(urlPainel()).origin];
  if (!origem || !permitidas.includes(origem) || req.headers.get("sec-fetch-site") === "cross-site") {
    throw new ErroNegocio("Abra esta ação dentro do aplicativo da barbearia.", 403, "origem_invalida");
  }
  return origem;
}

export async function corpoNotificacoes<T extends z.ZodType>(req: Request, schema: T, vazio = false): Promise<z.infer<T>> {
  if (Number(req.headers.get("content-length") ?? 0) > 12_000) throw new ErroNegocio("Dados de inscrição grandes demais.", 413);
  const texto = await req.text();
  if (texto.length > 12_000) throw new ErroNegocio("Dados de inscrição grandes demais.", 413);
  if (!texto && vazio) return schema.parse({});
  if (req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new ErroNegocio("Envie os dados em JSON.", 415);
  let dados: unknown;
  try { dados = JSON.parse(texto); } catch { throw new ErroNegocio("Dados inválidos.", 400); }
  return schema.parse(dados);
}
