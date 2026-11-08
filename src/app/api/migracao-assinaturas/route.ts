import { NextResponse } from "next/server";
import { exigirSessao, GESTAO } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { zAcaoMigracao, zConsultaMigracao } from "@/lib/migracao-assinaturas/schemas";
import { listarQuadroMigracao, registrarMigracao } from "@/lib/migracao-assinaturas/servico";
import { corpo, parametros } from "@/lib/validacao";

export const dynamic = "force-dynamic";
export const GET = rota(async (req: Request) => {
  await exigirSessao(GESTAO);
  return NextResponse.json(await listarQuadroMigracao(parametros(req, zConsultaMigracao)));
});
export const POST = rota(async (req: Request) => {
  const s = await exigirSessao(GESTAO);
  return NextResponse.json(await registrarMigracao(s, await corpo(req, zAcaoMigracao)));
});
