import { z } from "zod";
import { parseData } from "@/lib/agenda/tempo";
import { zData, zId } from "@/lib/validacao";

export const schemaEsperaHorario = z.object({
  data: zData.refine(data => { try { parseData(data); return true; } catch { return false; } }, "Data inválida."),
  servicoId: zId,
  servicosAdicionais: z.array(zId).max(9).default([]),
  barbeiroId: zId.nullish(),
  periodo: z.enum(["QUALQUER", "MANHA", "TARDE", "NOITE"]).default("QUALQUER"),
}).strict().refine(e => new Set([e.servicoId, ...e.servicosAdicionais]).size === e.servicosAdicionais.length + 1,
  "Os serviços não podem se repetir.");

/** A espera depende do conjunto de serviços, não da ordem dos cliques. */
export function servicosDaEspera(servicoId: string, adicionais: string[] = []) {
  return [servicoId, ...adicionais].sort();
}
