import { NextResponse } from "next/server";
import { exigirSessao } from "@/lib/auth/sessao";
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal, instanteLocal } from "@/lib/agenda/tempo";
import { configRetencao, salvarConfigRetencao } from "@/lib/assinaturas/retencao";
import { ROTULO_MOTIVO, resumoPorMotivo } from "@/lib/assinaturas/retencao-regras";
import { schemaConfigRetencao } from "@/lib/assinaturas/schemas";
import { db } from "@/lib/db";
import { rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";

/** Indicador do mes (cancelamentos e retencoes por motivo), ultimos pedidos e as ofertas configuradas. */
export const GET = rota(async () => {
  await exigirSessao(["DONO", "RECEPCAO"]);
  const cfg = await configuracao();
  const inicioMes = new Date(instanteLocal(`${dataLocal(Date.now(), cfg.fuso).slice(0, 8)}01`, 0, cfg.fuso));
  const [linhas, recentes, ofertas, pausadas, encerrando] = await Promise.all([
    db.retencaoAssinatura.findMany({ where: { criadoEm: { gte: inicioMes } }, select: { motivo: true, desfecho: true } }),
    db.retencaoAssinatura.findMany({
      orderBy: { criadoEm: "desc" },
      take: 15,
      include: { assinatura: { select: { id: true, cliente: { select: { nome: true, telefone: true } }, plano: { select: { nome: true } } } } },
    }),
    configRetencao(),
    db.assinatura.count({ where: { pausadaEm: { not: null }, status: { not: "CANCELADA" } } }),
    db.assinatura.count({ where: { encerraEm: { not: null }, status: { not: "CANCELADA" } } }),
  ]);
  return NextResponse.json({
    mes: resumoPorMotivo(linhas),
    pausadas,
    encerrando,
    recentes: recentes.map((r) => ({
      id: r.id, assinaturaId: r.assinaturaId, motivo: ROTULO_MOTIVO[r.motivo], detalhe: r.detalhe, desfecho: r.desfecho,
      origem: r.origem, criadoEm: r.criadoEm, cliente: r.assinatura.cliente, plano: r.assinatura.plano.nome,
    })),
    ofertas,
  });
});

/** Ofertas de retencao: so o dono configura. */
export const PUT = rota(async (req: Request) => {
  const s = await exigirSessao(["DONO"]);
  const b = await corpo(req, schemaConfigRetencao);
  const r = await salvarConfigRetencao(b, s.usuarioId);
  return NextResponse.json(r);
});
