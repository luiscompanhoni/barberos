import { NextResponse } from "next/server";
import { encerrarSessao } from "@/lib/auth/sessao";

export async function POST() {
  await encerrarSessao();
  return NextResponse.json({ ok: true });
}
