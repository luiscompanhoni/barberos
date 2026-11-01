import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Usada pelo healthcheck do Docker/hospedagem: confere que o banco responde. */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    const valor = process.env.BARBEROS_REVISAO ?? "";
    const revisao = /^[a-f0-9]{40}$/.test(valor) ? valor : null;
    return NextResponse.json({ ok: true, revisao }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
