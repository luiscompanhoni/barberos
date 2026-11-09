import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";
import { conectarOficial } from "@/lib/whatsapp/oficial";

export const dynamic = "force-dynamic";

const idMeta = z.string().regex(/^\d{5,25}$/);

/** Fim do cadastro incorporado da Meta: o navegador manda o codigo (vale 30 s) e os ids. */
export const POST = rota(async (req: Request) => {
  const s = await exigirSessao(["DONO"]);
  const p = await corpo(req, z.object({ code: z.string().min(10).max(2000), wabaId: idMeta, phoneNumberId: idMeta.optional() }));
  return NextResponse.json(await conectarOficial(p, s.usuarioId));
});
