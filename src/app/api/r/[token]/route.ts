import { NextResponse } from "next/server";
import { z } from "zod";
import { origemDaRequisicao } from "@/lib/auditoria";
import { registrarClique } from "@/lib/campanhas/link";
import { naoEncontrado, rota } from "@/lib/erros";
import { jogarPelaCampanha } from "@/lib/jogos/motor";
import { limitar } from "@/lib/limite";
import { corpo } from "@/lib/validacao";

/** Link rastreado da campanha (sem login): "visita" quando a pagina abre no navegador; "jogar" usa o presente. */
export const POST = rota(async (req: Request, ctx: RouteContext<"/api/r/[token]">) => {
  const { token } = await ctx.params;
  if (!/^[\w-]{10,40}$/.test(token)) throw naoEncontrado("Link");
  const origem = await origemDaRequisicao();
  limitar(`r:${origem.ip ?? "?"}`, 30, 60_000);
  const b = await corpo(req, z.object({ acao: z.enum(["visita", "jogar"]) }));
  if (b.acao === "visita") {
    await registrarClique(token);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json(await jogarPelaCampanha(token, origem));
});
