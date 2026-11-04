import { NextResponse } from "next/server";
import { exigirSessaoCom } from "@/lib/auth/permissoes";
import { rota } from "@/lib/erros";
import { zDecidirEstorno } from "@/lib/estornos/schemas";
import { decidirEstorno } from "@/lib/estornos/servico";
import { corpoCobrancaEquipe } from "@/lib/pagamentos/http-equipe";

/** So o dono: aprovar, recusar (com motivo), tentar de novo ou registrar que devolveu por fora. */
export const PATCH = rota(async (req: Request, ctx: RouteContext<"/api/estornos/[id]">) => {
  const s = await exigirSessaoCom("estorno");
  const { id } = await ctx.params;
  const b = await corpoCobrancaEquipe(req, zDecidirEstorno);
  return NextResponse.json({ estorno: await decidirEstorno(s, id, b) });
});
