import type { Agendamento, Prisma } from "@prisma/client";
import { precificar } from "@/lib/assinaturas/agenda";
import { ErroNegocio } from "@/lib/erros";
import { servicoDoBarbeiro } from "./carregar";

/** Mover/reativar um horário não é um aceite de nova cobrança avulsa. */
export async function revalidarCoberturaEquipe(tx: Prisma.TransactionClient, ag: Agendamento, destino: { barbeiroId: string; inicio: number; fuso: string }) {
  if (!ag.assinaturaId) return;
  const servico = await servicoDoBarbeiro(destino.barbeiroId, ag.servicoId, tx);
  if (!servico) throw new ErroNegocio("O profissional não realiza mais este serviço.", 409);
  const preco = await precificar({ clienteId: ag.clienteId, servicoId: ag.servicoId, barbeiroId: destino.barbeiroId,
    inicio: destino.inicio, precoBase: servico.precoCentavos, fuso: destino.fuso, ignorarAgendamentoId: ag.id, c: tx });
  if (preco.assinaturaId !== ag.assinaturaId || preco.precoCentavos !== ag.precoCentavos) {
    throw new ErroNegocio("A cobertura do plano mudou. Confira o novo valor com o cliente e faça um novo agendamento.", 409, "cobertura_alterada");
  }
}
