import { BALCAO, exigirSessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { naoEncontrado, rota } from "@/lib/erros";

export const GET = rota(async (_req: Request, ctx: RouteContext<"/api/clientes/gestao/[id]/foto">) => {
  await exigirSessao(BALCAO);
  const c = await db.cliente.findFirst({ where: { id: (await ctx.params).id, excluidoEm: null }, select: { fotoDados: true, fotoTipo: true } });
  if (!c?.fotoDados || !c.fotoTipo) throw naoEncontrado("Foto");
  return new Response(new Uint8Array(c.fotoDados), { headers: {
    "Content-Type": c.fotoTipo, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
  } });
});
