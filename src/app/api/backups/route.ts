import { NextResponse } from "next/server";
import { exigirSessao } from "@/lib/auth/sessao";
import { listarBackups } from "@/lib/backups";
import { rota } from "@/lib/erros";

export const dynamic = "force-dynamic";

/** Ultimos backups do banco (so o dono). */
export const GET = rota(async () => {
  await exigirSessao(["DONO"]);
  return NextResponse.json(await listarBackups());
});
