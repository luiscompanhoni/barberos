import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao, GESTAO } from "@/lib/auth/sessao";
import { editarCampanha, liberarLote, mudarStatus } from "@/lib/campanhas/servico";
import { schemaCampanha } from "@/lib/campanhas/schemas";
import { rota } from "@/lib/erros";
import { corpoCobrancaEquipe } from "@/lib/pagamentos/http-equipe";

/** Libera o proximo lote ou pausa/retoma/encerra a campanha. */
export const PATCH = rota(async (req: Request, ctx: RouteContext<"/api/campanhas/[id]">) => {
  const s = await exigirSessao(GESTAO);
  const { id } = await ctx.params;
  const b = await corpoCobrancaEquipe(req, z.discriminatedUnion("acao", [
    z.object({ acao: z.literal("lote"), quantidade: z.number().int().min(1).max(500) }),
    z.object({ acao: z.enum(["pausar", "retomar", "encerrar"]) }),
    z.object({ acao: z.literal("editar"), campanha: schemaCampanha }),
  ]));
  if (b.acao === "lote") return NextResponse.json(await liberarLote(s, id, b.quantidade));
  if (b.acao === "editar") return NextResponse.json(await editarCampanha(s, id, b.campanha));
  await mudarStatus(s, id, b.acao);
  return NextResponse.json({ ok: true });
});
