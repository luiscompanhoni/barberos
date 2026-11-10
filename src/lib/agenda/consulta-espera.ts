import { db } from "@/lib/db";
import { naoEncontrado } from "@/lib/erros";

/** Exceção de leitura para a rotina; não autoriza reserva nem aceita um bypass público. */
export async function comprovarConsultaEsperaSite(esperaId: string, consulta: {
  data: string; servicoId: string; servicosAdicionais?: string[]; barbeiroId?: string;
}) {
  const espera = await db.esperaHorario.findFirst({ where: { id: esperaId, origem: "SITE", status: "ATIVA", cliente: { excluidoEm: null } },
    select: { data: true, servicoId: true, servicosAdicionais: true, barbeiroId: true } });
  const ids = (servicoId: string, adicionais: string[] = []) => JSON.stringify([servicoId, ...adicionais].sort());
  if (!espera || espera.data.toISOString().slice(0, 10) !== consulta.data || espera.barbeiroId !== (consulta.barbeiroId ?? null) ||
    ids(espera.servicoId, espera.servicosAdicionais) !== ids(consulta.servicoId, consulta.servicosAdicionais)) throw naoEncontrado("Pedido de aviso");
}
