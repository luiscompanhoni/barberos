import { z } from "zod";
import { ErroNegocio } from "@/lib/erros";

export const zData = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato AAAA-MM-DD");
export const zInstante = z.iso.datetime({ offset: true }).transform((s) => new Date(s));
export const zId = z.string().min(1).max(40);
export const zIntervaloMin = z.object({
  inicioMin: z.number().int().min(0).max(1440),
  fimMin: z.number().int().min(0).max(1440),
});

/** Le o corpo JSON e valida (erros viram 400 no wrapper `rota`). */
export async function corpo<T extends z.ZodType>(req: Request, schema: T, opcoes: { maxBytes?: number; tipoJson?: boolean } = {}): Promise<z.infer<T>> {
  if (opcoes.tipoJson && req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new ErroNegocio("Envie os dados como JSON.", 415);
  }
  // 1 MiB preserva fotos em base64 já aceitas nas rotas autenticadas. Checkout
  // usa teto menor; o limite vale também sem Content-Length ou com valor falso.
  const maximo = opcoes.maxBytes ?? 1_048_576;
  const leitor = req.body?.getReader();
  if (!leitor) return schema.parse(undefined);
  const partes: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximo) {
        await leitor.cancel();
        throw new ErroNegocio("Dados acima do limite.", 413, "corpo_grande");
      }
      partes.push(value);
    }
  } finally { leitor.releaseLock(); }
  let json: unknown;
  try {
    json = JSON.parse(Buffer.concat(partes).toString("utf8"));
  } catch {
    json = undefined;
  }
  return schema.parse(json);
}

export function parametros<T extends z.ZodType>(req: Request, schema: T): z.infer<T> {
  return schema.parse(Object.fromEntries(new URL(req.url).searchParams));
}
