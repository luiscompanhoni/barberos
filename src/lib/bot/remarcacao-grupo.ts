import { db } from "@/lib/db";
import { urlSite } from "@/lib/dominios";
import { checarConfirmacaoAutomatica } from "@/lib/agenda/transicao";
import type { ResultadoFerramenta } from "./ferramentas";

/** O bot ainda não tem aceite estruturado do total do grupo; usa o fluxo do app. */
export async function orientarRemarcacaoGrupo(clienteId: string, agendamentoId: string, cfg: { agendaExternaAtiva?: boolean }): Promise<ResultadoFerramenta | null> {
  const grupo = await db.agendamento.findFirst({ where: {
    id: agendamentoId, clienteId, adicionalDeId: null, status: { in: ["MARCADO", "CONFIRMADO"] },
    adicionais: { some: { origem: "SITE", status: { not: "CANCELADO" } } },
  }, select: { id: true } });
  if (!grupo) return null;
  // Durante a transição, mantém o encaminhamento humano já utilizado pelo bot.
  checarConfirmacaoAutomatica(cfg);
  return { texto: `Esse horário reúne vários serviços. Para conferir o valor total e confirmar a mudança de todos juntos, abra ${urlSite()}/c e toque em Remarcar no seu horário. O agendamento atual foi mantido. Se precisar, posso chamar a equipe.`, erro: true };
}
