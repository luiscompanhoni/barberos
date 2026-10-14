import { NextResponse } from "next/server";
import { BALCAO, exigirSessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { rota } from "@/lib/erros";

/** Ultimas mensagens automaticas enviadas e o total por tipo nos ultimos 7 dias. */
export const GET = rota(async () => {
  await exigirSessao(BALCAO);
  const [ultimas, porTipo, semMensagens] = await Promise.all([
    db.automacaoEnviada.findMany({ orderBy: { criadoEm: "desc" }, take: 40 }),
    db.automacaoEnviada.groupBy({ by: ["tipo"], where: { criadoEm: { gt: new Date(Date.now() - 7 * 24 * 3_600_000) } }, _count: true }),
    db.cliente.count({ where: { aceitaMensagens: false } }),
  ]);
  const clientes = await db.cliente.findMany({ where: { id: { in: [...new Set(ultimas.map((u) => u.clienteId))] } }, select: { id: true, nome: true } });
  const nome = new Map(clientes.map((c) => [c.id, c.nome]));
  return NextResponse.json({
    ultimas: ultimas.map((u) => ({ id: u.id, tipo: u.tipo, ok: u.ok, erro: u.erro, criadoEm: u.criadoEm, cliente: nome.get(u.clienteId) ?? "—" })),
    semana: Object.fromEntries(porTipo.map((p) => [p.tipo, p._count])),
    semMensagens,
  });
});
