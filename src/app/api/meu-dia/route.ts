import { NextResponse } from "next/server";
import { exigirSessao } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { parametros } from "@/lib/validacao";
import { carregarMeuDia } from "@/lib/reunioes/meu-dia";
import { meuDiaSchema } from "@/lib/reunioes/schemas";

export const GET = rota(async (req: Request) => {
  const s = await exigirSessao();
  return NextResponse.json(await carregarMeuDia(s, parametros(req, meuDiaSchema)));
});
