import { z } from "zod";

const zMemoria = z.object({
  nivel: z.enum(["ELITE", "PLATINA", "LEGEND"]),
  pontosAnteriores: z.number(),
  resultado: z.object({
    elegivel: z.boolean(), pendencias: z.array(z.string()), pontos: z.number(), bonusCentavos: z.number(), previstoCentavos: z.number(),
    criterios: z.array(z.object({ nome: z.string(), cumpriu: z.boolean(), detalhe: z.string() })),
  }),
});

/** Exibe os critérios da aprovação, mesmo se indicadores vivos receberem dados novos. */
export function memoriaBonus(valor: unknown) {
  const r = zMemoria.safeParse(valor);
  return r.success ? r.data : null;
}
