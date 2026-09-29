import { z } from "zod";

export const zData = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato AAAA-MM-DD");
export const zInstante = z.iso.datetime({ offset: true }).transform((s) => new Date(s));
export const zId = z.string().min(1).max(40);
export const zIntervaloMin = z.object({
  inicioMin: z.number().int().min(0).max(1440),
  fimMin: z.number().int().min(0).max(1440),
});

/** Le o corpo JSON e valida (erros viram 400 no wrapper `rota`). */
export async function corpo<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    json = undefined;
  }
  return schema.parse(json);
}

export function parametros<T extends z.ZodType>(req: Request, schema: T): z.infer<T> {
  return schema.parse(Object.fromEntries(new URL(req.url).searchParams));
}
