import { NextResponse } from "next/server";
import { z } from "zod";
import { BALCAO, exigirSessao } from "@/lib/auth/sessao";
import { previaPedido } from "@/lib/agenda/pedidos-previa";
import { rota } from "@/lib/erros";
import { parametros, zId, zInstante } from "@/lib/validacao";

export const GET = rota(async (req: Request) => {
  await exigirSessao(BALCAO);
  const p = parametros(req, z.object({ id: zId, barbeiroId: zId, inicio: zInstante }));
  return NextResponse.json(await previaPedido(p.id, p.barbeiroId, p.inicio), { headers: { "Cache-Control": "private, no-store" } });
});
