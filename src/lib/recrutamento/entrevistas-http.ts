import { z } from "zod";
import { ErroNegocio } from "@/lib/erros";
export async function corpoEntrevista<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  const reader = req.body?.getReader(); if (!reader) throw new ErroNegocio("Pedido vazio.", 400);
  const partes: Uint8Array[] = []; let total = 0;
  while (true) { const p = await reader.read(); if (p.done) break; total += p.value.length;
    if (total > 16_000) { await reader.cancel(); throw new ErroNegocio("Pedido muito grande.", 413); } partes.push(p.value);
  }
  let b: unknown; try { b = JSON.parse(Buffer.concat(partes).toString("utf8")); } catch { throw new ErroNegocio("Pedido inválido.", 400); }
  return schema.parse(b);
}
