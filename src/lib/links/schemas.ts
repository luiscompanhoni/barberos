import { z } from "zod";

/** Novo link de pagamento (painel). Cliente cadastrado OU nome + telefone. */
export const zNovoLink = z.object({
  clienteId: z.string().min(1).max(40).nullish(),
  nome: z.string().trim().max(80).nullish(),
  telefone: z.string().trim().max(30).nullish(),
  comandaId: z.string().min(1).max(40).nullish(),
  descricao: z.string().trim().min(2).max(120),
  valorCentavos: z.number().int().min(1).max(5_000_000),
  validadeDias: z.number().int().min(1).max(30).default(3),
  parcelasMax: z.number().int().min(1).max(12).default(1),
  enviar: z.boolean().default(false),
});

export const zAcaoLink = z.object({ acao: z.enum(["cancelar", "enviar", "conferir"]) });
