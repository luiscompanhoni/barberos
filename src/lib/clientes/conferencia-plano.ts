import { z } from "zod";
import { db } from "@/lib/db";

const situacoes = ["PAGO_CELCOIN", "VENCIDO_NA_CELCOIN", "PAGO_FORA", "DADOS_A_CONFERIR", "CANCELADO", "SEM_CICLO", "VENCE_HOJE", "SEM_CICLO_ATUAL_COMPROVADO"] as const;
const formato = z.object({
  dataCorte: z.iso.date(),
  confirmacaoGerencial: z.object({
    plano: z.string().trim().min(1).max(120),
    acessoAteInclusive: z.iso.date(),
  }).strict().optional(),
  contratos: z.array(z.object({
    plano: z.string().trim().min(1).max(120),
    valorCentavos: z.number().int().nonnegative(),
    vencimento: z.iso.date().nullable(),
    proximoVencimento: z.iso.date().nullable(),
    situacao: z.enum(situacoes),
  }).strict()).min(1).max(20),
}).strict();

export type ConferenciaPlano = z.infer<typeof formato>;

/** Um evento de conferência documenta a observação da equipe no corte. Apenas para exibição. */
export async function consultarConferenciaPlano(clienteId: string, hoje: string): Promise<ConferenciaPlano | null> {
  const registro = await db.auditoria.findFirst({
    where: { entidade: "cliente", entidadeId: clienteId, acao: "conferir_planos_celcoin" },
    orderBy: [{ criadoEm: "desc" }, { id: "desc" }],
    select: { dados: true },
  });
  const resultado = formato.safeParse(registro?.dados);
  return resultado.success && resultado.data.dataCorte <= hoje ? resultado.data : null;
}
