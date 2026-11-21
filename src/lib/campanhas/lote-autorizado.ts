import { createHash } from "node:crypto";
import { z } from "zod";
import { ehHomologacao } from "@/lib/ambiente";
import { db } from "@/lib/db";
import { quarentenaRestauracao } from "@/lib/recuperacao/quarentena";
import { estadoPiloto } from "@/lib/whatsapp/piloto";
import { testeEquipeAtivo } from "@/lib/whatsapp/teste-equipe";

const schema = z.object({
  campanhaId: z.string().min(1),
  clienteIds: z.array(z.string().min(1)).min(1).max(20),
  revisao: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().refine(lote => new Set(lote.clienteIds).size === lote.clienteIds.length);

type CampanhaRevisada = { id: string; segmentos: string[]; mensagem: string; jogoId: string | null; limiteDiario: number };
export type LoteAutorizado = z.infer<typeof schema>;

/** Autoriza um único lote no canal atual, enquanto os envios gerais estão bloqueados. */
export function loteAutorizadoConfigurado() {
  const entrada = process.env.WHATSAPP_LOTE_CAMPANHA_AUTORIZADO;
  if (!entrada || process.env.WHATSAPP_ENVIOS_BLOQUEADOS !== "true" || quarentenaRestauracao() || testeEquipeAtivo()) return null;
  if (process.env.WHATSAPP_PROVIDER !== "evolution" && !ehHomologacao()) return null;
  try {
    const resultado = schema.safeParse(JSON.parse(entrada));
    return resultado.success ? resultado.data : null;
  } catch {
    return null;
  }
}

export async function loteAutorizadoDisponivel() {
  const lote = loteAutorizadoConfigurado();
  return lote && !(await estadoPiloto())?.ativo ? lote : null;
}

export function revisaoDaCampanha(campanha: CampanhaRevisada) {
  const { id, segmentos, mensagem, jogoId, limiteDiario } = campanha;
  return createHash("sha256").update(JSON.stringify([2, id, segmentos, mensagem, jogoId, limiteDiario])).digest("hex");
}

export function campanhaConferida(campanha: CampanhaRevisada, lote: LoteAutorizado) {
  return campanha.id === lote.campanhaId && campanha.limiteDiario >= lote.clienteIds.length && revisaoDaCampanha(campanha) === lote.revisao;
}

export function identificadorDoLote(lote: LoteAutorizado) {
  return createHash("sha256").update(JSON.stringify([lote.revisao, [...lote.clienteIds].sort()])).digest("hex");
}

/** Uma fila anterior à confirmação do lote no painel nunca recebe a autorização. */
export async function loteAutorizadoConfirmado(lote: LoteAutorizado) {
  return !!await db.auditoria.findFirst({
    where: {
      entidade: "campanha", entidadeId: lote.campanhaId, acao: "liberar_lote",
      dados: { path: ["autorizacao"], equals: identificadorDoLote(lote) },
    },
    select: { id: true },
  });
}
