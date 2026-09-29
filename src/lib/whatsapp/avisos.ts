import { db } from "@/lib/db";
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal, minParaHhmm, minutosLocal } from "@/lib/agenda/tempo";
import { notificarEmSegundoPlano } from "./conversas";

type Motivo = "remarcado" | "cancelado" | "transferido";

function quando(inicio: Date, fuso: string) {
  const d = dataLocal(inicio, fuso);
  const dia = new Date(`${d}T12:00:00Z`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "UTC" });
  return `${dia} às ${minParaHhmm(minutosLocal(inicio, fuso))}`;
}

/**
 * Avisa o cliente quando a equipe mexe no horario dele. Nao bloqueia a acao e
 * so avisa atendimentos futuros.
 */
export async function avisarMudanca(agendamentoId: string, motivo: Motivo) {
  try {
    const cfg = await configuracao();
    const ag = await db.agendamento.findUnique({
      where: { id: agendamentoId },
      include: { cliente: true, barbeiro: { select: { nome: true } }, servico: { select: { nome: true } } },
    });
    if (!ag || ag.inicio.getTime() < Date.now()) return;
    const nome = ag.cliente.nome.split(" ")[0];
    const texto =
      motivo === "cancelado"
        ? `Oi, ${nome}! Seu horário de ${ag.servico.nome} de ${quando(ag.inicio, cfg.fuso)} foi cancelado pela barbearia. Quer que eu veja outro horário para você?`
        : motivo === "transferido"
          ? `Oi, ${nome}! Seu horário de ${ag.servico.nome} continua ${quando(ag.inicio, cfg.fuso)}, mas agora com o ${ag.barbeiro.nome}. Qualquer coisa, é só responder aqui.`
          : `Oi, ${nome}! Seu horário de ${ag.servico.nome} mudou para ${quando(ag.inicio, cfg.fuso)} com o ${ag.barbeiro.nome}. Se não puder, responda aqui que a gente ajeita.`;
    notificarEmSegundoPlano(ag.cliente.telefone, texto);
  } catch (e) {
    console.error("[avisos] falha ao montar aviso:", e);
  }
}
