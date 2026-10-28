import { NextResponse } from "next/server";
import { exigirReunioes } from "@/lib/auth/permissoes";
import { rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";
import { criarReuniaoSchema } from "@/lib/reunioes/schemas";
import { criarReuniao, listarReunioes } from "@/lib/reunioes/servico";

export const GET = rota(async () => NextResponse.json(await listarReunioes(await exigirReunioes())));
export const POST = rota(async (req: Request) => {
  const s = await exigirReunioes();
  return NextResponse.json(await criarReuniao(s, await corpo(req, criarReuniaoSchema)), { status: 201 });
});
