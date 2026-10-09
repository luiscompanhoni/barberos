import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { exportarCsv } from "@/lib/rh/folha";
import { parametros } from "@/lib/validacao";

export const dynamic = "force-dynamic";

/** Folha do mes em CSV (abre no Excel). */
export const GET = rota(async (req: Request) => {
  await exigirSessao(["DONO"]);
  const { competencia } = parametros(req, z.object({ competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }));
  const csv = await exportarCsv(competencia);
  return new Response(`﻿${csv}`, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="folha-${competencia}.csv"` },
  });
});
