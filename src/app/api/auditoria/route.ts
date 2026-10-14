import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { consultarAuditoria } from "@/lib/auditoria-consulta";
import { rota } from "@/lib/erros";
import { parametros, zData } from "@/lib/validacao";

export const dynamic = "force-dynamic";

/** Log de auditoria (so o dono). */
export const GET = rota(async (req: Request) => {
  await exigirSessao(["DONO"]);
  const p = parametros(req, z.object({
    de: zData, ate: zData,
    usuarioId: z.string().max(40).optional(),
    entidade: z.string().max(40).optional(),
    depois: z.string().regex(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\|[\w-]{1,40}$/).optional(),
  }));
  return NextResponse.json(await consultarAuditoria(p));
});
