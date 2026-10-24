import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao, GESTAO } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { rota } from "@/lib/erros";
import { ETAPAS } from "@/lib/recrutamento/regras";
export const dynamic = "force-dynamic";
export const GET = rota(async (req: Request) => {
  await exigirSessao(GESTAO);
  const p = z.object({ vagaId: z.string().max(40).optional(), etapa: z.enum(ETAPAS).optional(), busca: z.string().max(100).optional(), pagina: z.coerce.number().int().min(1).max(10000).default(1) }).parse(Object.fromEntries(new URL(req.url).searchParams));
  const where = { ...(p.vagaId ? { vagaId: p.vagaId } : {}), ...(p.etapa ? { etapa: p.etapa } : {}), ...(p.busca ? { candidato: { nome: { contains: p.busca, mode: "insensitive" as const } } } : {}) };
  const [total, candidaturas] = await db.$transaction([
    db.candidaturaRecrutamento.count({ where }),
    db.candidaturaRecrutamento.findMany({ where, orderBy: [{ criadoEm: "desc" }, { id: "desc" }], take: 30, skip: (p.pagina - 1) * 30,
      select: { id: true, candidato: true, vaga: { select: { titulo: true } }, etapa: true, versao: true, criadoEm: true, experienciaMeses: true, servicos: true, disponibilidade: true, portfolio: true, instagram: true, futurasOportunidades: true, origem: true, historico: { orderBy: { criadoEm: "desc" }, take: 10 } },
    }),
  ]);
  return NextResponse.json({ total, candidaturas, pagina: p.pagina }, { headers: { "Cache-Control": "no-store" } });
});
