import { NextResponse } from "next/server";
import { EQUIPE, exigirSessao } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { caixaNotificacoes } from "@/lib/notificacoes/caixa";
import { tokenDoDispositivo } from "@/lib/notificacoes/inscricoes";

export const dynamic = "force-dynamic";
export const GET = rota(async () => {
  const s = await exigirSessao([...EQUIPE, "CLIENTE"]);
  return NextResponse.json(await caixaNotificacoes(s, await tokenDoDispositivo()), { headers: { "Cache-Control": "private, no-store" } });
});
