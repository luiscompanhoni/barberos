import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirPermissao } from "@/lib/auth/permissoes";
import { exigirSessao } from "@/lib/auth/sessao";
import { horariosDisponiveis } from "@/lib/agenda/consultas";
import { rota } from "@/lib/erros";
import { parametros, zData, zId } from "@/lib/validacao";

export const GET = rota(async (req: Request) => {
  const s = await exigirSessao();
  const q = parametros(req, z.object({ data: zData, servicoId: zId, barbeiroId: zId.optional(), duracaoMin: z.coerce.number().int().min(5).max(480).optional(), cadeiraId: z.string().max(40).optional() }));
  if (q.duracaoMin !== undefined) await exigirPermissao(s, "duracao");
  return NextResponse.json(await horariosDisponiveis({ ...q, cadeiraId: q.cadeiraId === "" ? null : q.cadeiraId, paraCliente: false }));
});
