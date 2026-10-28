import { NextResponse } from "next/server";
import { EQUIPE, exigirSessao } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { marcarNotificacaoLida } from "@/lib/notificacoes/caixa";
import { exigirOrigemNotificacoes } from "@/lib/notificacoes/seguranca";

export const PATCH = rota(async (req: Request, ctx: RouteContext<"/api/notificacoes/[id]">) => {
  exigirOrigemNotificacoes(req);
  const s = await exigirSessao([...EQUIPE, "CLIENTE"]);
  return NextResponse.json(await marcarNotificacaoLida(s, (await ctx.params).id));
});
