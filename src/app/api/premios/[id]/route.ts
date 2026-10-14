import { NextResponse } from "next/server";
import { z } from "zod";
import { BALCAO, GESTAO, exigirSessao } from "@/lib/auth/sessao";
import { proibido, rota } from "@/lib/erros";
import { cancelarPremio, desfazerValidacao, validarPremio } from "@/lib/jogos/premios";
import { corpo } from "@/lib/validacao";

/** Recepcao valida (ou desfaz no mesmo dia); so a gerencia cancela, com motivo. */
export const POST = rota(async (req: Request, ctx: RouteContext<"/api/premios/[id]">) => {
  const s = await exigirSessao(BALCAO);
  const { id } = await ctx.params;
  const b = await corpo(req, z.discriminatedUnion("acao", [
    z.object({ acao: z.literal("validar"), comandaId: z.string().max(40).nullable().optional(), codigo: z.string().max(20).nullable().optional() }),
    z.object({ acao: z.literal("desfazer") }),
    z.object({ acao: z.literal("cancelar"), motivo: z.string().trim().min(3).max(200) }),
  ]));
  if (b.acao === "validar") return NextResponse.json(await validarPremio(s, id, b));
  if (b.acao === "desfazer") {
    await desfazerValidacao(s, id);
    return NextResponse.json({ ok: true });
  }
  if (!GESTAO.includes(s.papel)) throw proibido();
  await cancelarPremio(s, id, b.motivo);
  return NextResponse.json({ ok: true });
});
