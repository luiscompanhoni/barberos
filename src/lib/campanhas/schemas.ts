import { z } from "zod";
import { CHAVES_SEGMENTO } from "./regras";

export const schemaCampanha = z.object({
  nome: z.string().trim().min(2).max(80),
  segmentos: z.array(z.enum(CHAVES_SEGMENTO)).min(1).max(10),
  mensagem: z.string().trim().min(10).max(900),
  limiteDiario: z.number().int().min(1).max(500),
  taxaRespostaBps: z.number().int().min(100).max(10_000),
  jogoId: z.string().max(40).nullable().default(null),
});
