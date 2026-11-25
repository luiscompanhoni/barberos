import { db } from "@/lib/db";
import { dadosAgenda, dadosNovoAgendamento } from "./geracao-regras";
import { textoAtendimento } from "./textos-agenda";

type Aviso = { categoria: string; dados: unknown; corpo: string };

/** Detalhes podem mudar enquanto o push está na fila. Nunca enviar a cópia antiga. */
export async function corpoAtualPush(n: Aviso, fuso: string) {
  const d = n.categoria === "AGENDA" ? dadosAgenda.safeParse(n.dados)
    : n.categoria === "EQUIPE" ? dadosNovoAgendamento.safeParse(n.dados) : null;
  if (!d?.success) return n.corpo;
  const a = await db.agendamento.findFirst({ where: {
    id: d.data.agendamentoId, adicionalDeId: null,
    ...(d.data.inicio ? { inicio: new Date(d.data.inicio) } : {}),
    status: { in: ["MARCADO", "CONFIRMADO", "CHEGOU", "EM_ATENDIMENTO"] },
  }, select: { inicio: true, cliente: { select: { nome: true } }, barbeiro: { select: { nome: true } }, servico: { select: { nome: true } },
    adicionais: { where: { status: { not: "CANCELADO" } }, select: { servico: { select: { nome: true } } }, orderBy: { inicio: "asc" } },
  } });
  if (!a) return null;
  return textoAtendimento({ inicio: a.inicio, barbeiro: a.barbeiro.nome, servicos: [a.servico.nome, ...a.adicionais.map(s => s.servico.nome)],
    ...(n.categoria === "EQUIPE" ? { cliente: a.cliente.nome } : {}),
  }, fuso);
}
