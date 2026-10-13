import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { naoEncontrado, rota } from "@/lib/erros";
import { situacaoDoCliente } from "@/lib/assinaturas/servico";
import { corpo } from "@/lib/validacao";
import { dataParaTexto, zPerfilCliente } from "@/lib/validacao-cliente";

/** Resumo do cliente para a equipe: frequencia, faltas e ultimos atendimentos. */
export const GET = rota(async (_req: Request, ctx: RouteContext<"/api/clientes/[id]">) => {
  await exigirSessao();
  const { id } = await ctx.params;
  const cliente = await db.cliente.findUnique({ where: { id }, select: { id: true, nome: true, observacoes: true, criadoEm: true, dataNascimento: true, origem: true, origemDetalhe: true } });
  if (!cliente) throw naoEncontrado("Cliente");
  const [ultimos, atendidos, faltas, sit] = await Promise.all([
    db.agendamento.findMany({
      where: { clienteId: id, inicio: { lt: new Date() }, status: { not: "CANCELADO" } },
      orderBy: { inicio: "desc" },
      take: 3,
      select: { id: true, inicio: true, status: true, servico: { select: { nome: true } }, barbeiro: { select: { nome: true } } },
    }),
    db.agendamento.count({ where: { clienteId: id, status: "CONCLUIDO" } }),
    db.agendamento.count({ where: { clienteId: id, status: "FALTOU" } }),
    situacaoDoCliente(id),
  ]);
  const plano = sit && { nome: sit.assinatura.plano.nome, status: sit.assinatura.status, valida: sit.valida };
  return NextResponse.json({ cliente: { ...cliente, dataNascimento: dataParaTexto(cliente.dataNascimento) }, ultimos, atendidos, faltas, plano });
});

/** Equipe completa o cadastro: preferencias, nascimento e como conheceu. */
export const PATCH = rota(async (req: Request, ctx: RouteContext<"/api/clientes/[id]">) => {
  await exigirSessao();
  const { id } = await ctx.params;
  const b = await corpo(req, zPerfilCliente.extend({ observacoes: z.string().trim().max(300).nullable().optional() }));
  const c = await db.cliente.update({ where: { id }, data: b, select: { dataNascimento: true, origem: true, origemDetalhe: true, observacoes: true } });
  return NextResponse.json({ ...c, dataNascimento: dataParaTexto(c.dataNascimento) });
});
