import { NextResponse } from "next/server";
import { exigirReunioes } from "@/lib/auth/permissoes";
import { rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";
import { criarAviso, criarAvisoSchema, listarAvisos } from "@/lib/reunioes/avisos";

export const GET = rota(async () => NextResponse.json(await listarAvisos(await exigirReunioes()), { headers: { "Cache-Control": "no-store" } }));
export const POST = rota(async (req: Request) => {
  const s = await exigirReunioes();
  return NextResponse.json(await criarAviso(s, await corpo(req, criarAvisoSchema)), { status: 201 });
});
