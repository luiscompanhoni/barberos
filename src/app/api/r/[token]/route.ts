import { NextResponse } from "next/server";
import { z } from "zod";
import { registrarClique } from "@/lib/campanhas/link";
import { naoEncontrado, rota } from "@/lib/erros";
import { girarPelaCampanha } from "@/lib/roleta/servico";
import { corpo } from "@/lib/validacao";

/** Link rastreado da campanha (sem login): "visita" quando a pagina abre no navegador; "girar" usa o giro de presente. */
export const POST = rota(async (req: Request, ctx: RouteContext<"/api/r/[token]">) => {
  const { token } = await ctx.params;
  if (!/^[\w-]{10,40}$/.test(token)) throw naoEncontrado("Link");
  const b = await corpo(req, z.object({ acao: z.enum(["visita", "girar"]) }));
  if (b.acao === "visita") {
    await registrarClique(token);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json(await girarPelaCampanha(token));
});
