import { z } from "zod";
const soma = z.object({ qtd: z.number(), base: z.number(), comissao: z.number(), adicional: z.number().optional() });
const comissao = z.object({
  avulso: soma, plano: soma, semRegra: z.number(),
  assinaturas: z.object({ qtd: z.number(), creditos: z.number(), receitaAtribuida: z.number(), percentualBaseBps: z.number().optional(), adicionalBps: z.number().optional(), comissaoBase: z.number().optional(), adicionalCentavos: z.number().optional(), comissao: z.number() }).nullable().optional(),
  produtos: z.object({ vendido: z.number(), comissao: z.number() }).nullable().optional(),
}).nullable();
const memoria = z.object({
  nome: z.string().optional(), cargo: z.string().nullable(), barbeiro: z.string().nullable(), barbeiroId: z.string().nullable().optional(), comissao,
  lancamentos: z.array(z.object({ id: z.string(), tipo: z.enum(["ADICIONAL", "BONUS", "VALE", "DESCONTO"]), valorCentavos: z.number().int(), descricao: z.string(), doCaixa: z.boolean(), criadoEm: z.coerce.date() })),
});
/** Memória ausente/incompleta nunca é substituída silenciosamente pelo cálculo de hoje. */
export function lerMemoriaFolha(dados: unknown) {
  const r = memoria.safeParse(dados);
  return r.success ? r.data : null;
}
