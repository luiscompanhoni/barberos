import type { PedidoResumo } from "./pedidos-tipos";

const rotulosPedido: Record<string, string> = {
  PENDENTE: "Aguardando conferência", APROVADO: "Pedido aprovado pela equipe",
  CANCELADO: "Pedido cancelado", RECUSADO: "Não foi possível confirmar",
};
const rotulosHorario: Record<string, string> = {
  MARCADO: "Horário confirmado", CONFIRMADO: "Horário confirmado", CHEGOU: "Chegada registrada",
  EM_ATENDIMENTO: "Atendimento em andamento", CONCLUIDO: "Atendimento concluído",
  FALTOU: "Falta registrada", CANCELADO: "Horário cancelado",
};

export function StatusPedidoAgendamento({ pedido }: { pedido: Pick<PedidoResumo, "status" | "agendamento"> }) {
  const ag = pedido.agendamento;
  const aprovado = pedido.status === "APROVADO";
  const encerrado = ag && ["CANCELADO", "CONCLUIDO", "FALTOU"].includes(ag.status);
  const rotulo = aprovado && ag ? rotulosHorario[ag.status] ?? "Consulte a situação em Meus horários" : rotulosPedido[pedido.status] ?? pedido.status;
  return <>
    <p className="text-sm font-semibold text-ouro">{rotulo}</p>
    {aprovado && encerrado && <p className="text-xs text-zinc-500">Pedido aprovado anteriormente pela equipe.</p>}
    {ag && <p className="text-sm">Agendamento: {new Date(ag.inicio).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })} com {ag.barbeiro.nome}. Consulte os detalhes em Meus horários.</p>}
  </>;
}
