import { NextResponse } from "next/server";
import { exigirSessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { naoEncontrado, rota } from "@/lib/erros";

/** Resumo do cliente para a equipe: frequencia, faltas e ultimos atendimentos. */
export const GET = rota(async (_req: Request, ctx: RouteContext<"/api/clientes/[id]">) => {
  await exigirSessao();
  const { id } = await ctx.params;
  const cliente = await db.cliente.findUnique({ where: { id }, select: { id: true, nome: true, observacoes: true, criadoEm: true } });
  if (!cliente) throw naoEncontrado("Cliente");
  const [ultimos, atendidos, faltas] = await Promise.all([
    db.agendamento.findMany({
      where: { clienteId: id, inicio: { lt: new Date() }, status: { not: "CANCELADO" } },
      orderBy: { inicio: "desc" },
      take: 3,
      select: { id: true, inicio: true, status: true, servico: { select: { nome: true } }, barbeiro: { select: { nome: true } } },
    }),
    db.agendamento.count({ where: { clienteId: id, status: "CONCLUIDO" } }),
    db.agendamento.count({ where: { clienteId: id, status: "FALTOU" } }),
  ]);
  return NextResponse.json({ cliente, ultimos, atendidos, faltas });
});
