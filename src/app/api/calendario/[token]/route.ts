import { configuracao } from "@/lib/agenda/carregar";
import { gerarIcs, type EventoIcs } from "@/lib/automacoes/calendario";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const DIA = 24 * 3_600_000;
const STATUS: Record<string, string> = { MARCADO: "marcado", CONFIRMADO: "confirmado", CHEGOU: "chegou", EM_ATENDIMENTO: "na cadeira", CONCLUIDO: "concluído", FALTOU: "faltou" };

/**
 * Agenda do barbeiro em .ics (publica, protegida pelo codigo secreto do link).
 * Sem telefone do cliente: so o primeiro nome e o servico.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/calendario/[token]">) {
  const token = (await ctx.params).token.replace(/\.ics$/, "");
  if (token.length < 20) return new Response("Não encontrado", { status: 404 });
  const barbeiro = await db.barbeiro.findUnique({ where: { tokenCalendario: token } });
  if (!barbeiro || !barbeiro.ativo) return new Response("Não encontrado", { status: 404 });

  const agora = Date.now();
  const [cfg, ags, bloqueios] = await Promise.all([
    configuracao(),
    db.agendamento.findMany({
      where: { barbeiroId: barbeiro.id, status: { not: "CANCELADO" }, inicio: { gt: new Date(agora - 14 * DIA), lt: new Date(agora + 90 * DIA) } },
      include: { cliente: { select: { nome: true } }, servico: { select: { nome: true } } },
    }),
    db.bloqueio.findMany({ where: { barbeiroId: barbeiro.id, fim: { gt: new Date(agora - 14 * DIA) }, inicio: { lt: new Date(agora + 90 * DIA) } } }),
  ]);

  const eventos: EventoIcs[] = [
    ...ags.map((a) => ({
      uid: `${a.id}@barberos`,
      inicio: a.inicio,
      fim: a.fim,
      titulo: `${a.servico.nome} · ${a.cliente.nome.trim().split(/\s+/)[0] || "Cliente"}${a.assinaturaId ? " (plano)" : ""}`,
      descricao: `Situação: ${STATUS[a.status] ?? a.status}${a.observacao ? `\nObs.: ${a.observacao}` : ""}`,
      confirmado: a.status !== "MARCADO",
    })),
    ...bloqueios.map((b) => ({ uid: `${b.id}@barberos-bloqueio`, inicio: b.inicio, fim: b.fim, titulo: `Fechado${b.motivo ? `: ${b.motivo}` : ""}` })),
  ];

  return new Response(gerarIcs(`${cfg.nomeBarbearia} · ${barbeiro.nome}`, eventos), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="agenda-${barbeiro.nome.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.ics"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}
