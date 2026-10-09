import { z } from "zod";
import { CATEGORIAS_DESPESA, FORMAS_DESPESA } from "@/lib/financeiro/regras";
import { zData } from "@/lib/validacao";

/** Campos da despesa (cadastro e edicao). */
export const zDadosDespesa = z.object({
  descricao: z.string().trim().min(2).max(120),
  categoria: z.enum(CATEGORIAS_DESPESA),
  valorCentavos: z.number().int().min(1).max(100_000_000),
  vencimento: zData,
  fornecedor: z.string().trim().max(120).nullish(),
  observacao: z.string().trim().max(500).nullish(),
  recorrente: z.boolean().default(false),
});

export const zPagarDespesa = z.object({ forma: z.enum(FORMAS_DESPESA), data: zData });
export const zMes = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mês no formato AAAA-MM");
