import { z } from "zod";
import { ErroNegocio } from "@/lib/erros";

const splitStone = z.array(z.object({
  amount: z.number().int().min(1).max(100),
  recipient_id: z.string().trim().regex(/^rp_[a-zA-Z0-9]+$/),
  type: z.literal("percentage"),
  options: z.object({
    liable: z.boolean(),
    charge_processing_fee: z.boolean(),
    charge_remainder_fee: z.boolean(),
  }).strict(),
}).strict()).min(1).refine(regras =>
  regras.reduce((total, regra) => total + regra.amount, 0) === 100
  && new Set(regras.map(regra => regra.recipient_id)).size === regras.length);

/** As regras homologadas vêm da configuração do servidor e nunca do operador. */
export function configuracaoStonePOS() {
  const serviceRefererName = process.env.STONE_POS_SERVICE_REFERER_NAME?.trim();
  if (!serviceRefererName || !/^[\x21-\x7E]+$/.test(serviceRefererName)) {
    throw new ErroNegocio("Identificador da integração Stone não configurado (STONE_POS_SERVICE_REFERER_NAME).", 503, "config");
  }
  let regras: unknown;
  try { regras = JSON.parse(process.env.STONE_POS_SPLIT_JSON ?? ""); } catch { /* configuração inválida */ }
  const split = splitStone.safeParse(regras);
  if (!split.success) {
    throw new ErroNegocio("Regras de split Stone ausentes ou inválidas (STONE_POS_SPLIT_JSON).", 503, "config");
  }
  return { serviceRefererName, split: split.data };
}
