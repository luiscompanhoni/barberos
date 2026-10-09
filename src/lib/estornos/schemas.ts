import { z } from "zod";
import { zId } from "@/lib/validacao";

export const zTipoEstorno = z.enum(["COMANDA", "ANTECIPADO", "LINK", "MENSALIDADE"]);

export const zPedirEstorno = z.object({
  tipo: zTipoEstorno,
  referenciaId: zId,
  valorCentavos: z.number().int().min(1).max(10_000_000),
  motivo: z.string().trim().min(3, "Escreva o motivo do estorno.").max(300),
});

export const zDecidirEstorno = z.object({
  acao: z.enum(["aprovar", "recusar", "tentar", "manual"]),
  motivo: z.string().trim().max(300).optional(),
});

export const zAlvoEstorno = z.object({ tipo: zTipoEstorno, id: zId });
