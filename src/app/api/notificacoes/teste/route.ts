import { NextResponse } from "next/server";
import { EQUIPE, exigirSessao } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { tokenDoDispositivo } from "@/lib/notificacoes/inscricoes";
import { exigirOrigemNotificacoes } from "@/lib/notificacoes/seguranca";
import { testarNotificacoes } from "@/lib/notificacoes/teste";

export const POST = rota(async (req: Request) => {
  exigirOrigemNotificacoes(req);
  const s = await exigirSessao([...EQUIPE, "CLIENTE"]);
  return NextResponse.json(await testarNotificacoes(s, await tokenDoDispositivo()));
});
