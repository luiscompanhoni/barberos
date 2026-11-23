import { z } from "zod";
import { zId } from "@/lib/validacao";
import { TERMO_DEZEMBRO } from "./regras";

export const CARTAO_DEZEMBRO_APROVADO = "dezembro_cartao_aprovado";
export const CARTAO_DEZEMBRO_RECUSADO = "dezembro_cartao_recusado";
const centavosOuUsos = z.number().int().min(1).max(2_147_483_647);

export const schemaAdesaoDezembro = z.strictObject({
  chave: z.uuid(),
  forma: z.literal("CARTAO"),
  cartaoToken: z.enum([CARTAO_DEZEMBRO_APROVADO, CARTAO_DEZEMBRO_RECUSADO]),
  aceitaTermos: z.literal(true),
  termosVersao: z.literal(TERMO_DEZEMBRO),
  planoId: zId,
  precoCentavos: centavosOuUsos,
  limiteUsos: centavosOuUsos,
});

export const schemaCancelamentoDezembro = z.strictObject({
  quando: z.enum(["agora", "fim_fidelidade"]),
});
