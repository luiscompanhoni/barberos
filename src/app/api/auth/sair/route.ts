import { NextResponse } from "next/server";
import { encerrarSessao } from "@/lib/auth/sessao";
import { revogarDispositivoAtual } from "@/lib/notificacoes/inscricoes";

export async function POST() {
  await revogarDispositivoAtual();
  await encerrarSessao();
  return NextResponse.json({ ok: true });
}
