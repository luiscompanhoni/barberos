import { NextResponse } from "next/server";
import { exigirSessao } from "@/lib/auth/sessao";
import { vagasRestantes } from "@/lib/assinaturas/servico";
import { db } from "@/lib/db";
import { rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";
import { schemaPlano } from "@/lib/assinaturas/schemas";

export const GET = rota(async () => {
  await exigirSessao();
  const planos = await db.plano.findMany({
    orderBy: [{ ordem: "asc" }, { precoCentavos: "asc" }],
    include: {
      servicos: { include: { servico: { select: { id: true, nome: true, precoCentavos: true } } } },
      barbeiros: { select: { barbeiroId: true } },
      _count: { select: { assinaturas: { where: { status: { in: ["ATIVA", "ATRASADA"] } } }, listaEspera: { where: { avisadoEm: null } } } },
    },
  });
  return NextResponse.json(await Promise.all(planos.map(async (p) => ({ ...p, vagasRestantes: await vagasRestantes(p) }))));
});

export const POST = rota(async (req: Request) => {
  await exigirSessao(["DONO"]);
  const { servicos, barbeiroIds, ...dados } = await corpo(req, schemaPlano);
  const plano = await db.plano.create({
    data: {
      ...dados,
      servicos: { create: servicos },
      barbeiros: { create: (barbeiroIds ?? []).map((barbeiroId) => ({ barbeiroId })) },
    },
  });
  return NextResponse.json(plano, { status: 201 });
});
