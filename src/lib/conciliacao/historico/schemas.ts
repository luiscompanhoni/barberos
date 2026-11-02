import { z } from "zod";

export const zTransacaoId = z.string().regex(/^[1-9]\d{0,14}$/, "Informe o código da transação Celcash.");
const zId = z.string().min(1).max(100);
export const zEscolhaHistorico = z.object({
  transacaoId: zTransacaoId,
  assinaturaId: zId,
  cobrancaId: zId.optional(),
  operacao: z.enum(["VINCULAR", "IMPORTAR", "ESTORNO"]),
  identidadeConfirmada: z.boolean().default(false),
  motivo: z.string().trim().min(10, "Explique a evidência da correção (mínimo 10 caracteres).").max(500),
}).strict();
export const zAplicarHistorico = zEscolhaHistorico.extend({
  revisao: z.string().regex(/^[a-f0-9]{64}$/),
  backupId: zId,
}).strict();
export type EscolhaHistorico = z.infer<typeof zEscolhaHistorico>;
export type AplicarHistorico = z.infer<typeof zAplicarHistorico>;

export type TransacaoHistorica = {
  id: string; contratoId: string | null; valorCentavos: number; vencimento: string;
  status: string; cliente: { nome: string; cpf: string; telefones: string[] };
};
