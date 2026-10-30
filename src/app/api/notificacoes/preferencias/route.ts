import { NextResponse } from "next/server";
import { EQUIPE, exigirSessao } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { salvarPreferenciasNotificacoes, zPreferencias } from "@/lib/notificacoes/preferencias";
import { corpoNotificacoes, exigirOrigemNotificacoes } from "@/lib/notificacoes/seguranca";

export const PUT = rota(async (req: Request) => {
  exigirOrigemNotificacoes(req);
  const s = await exigirSessao([...EQUIPE, "CLIENTE"]);
  return NextResponse.json(await salvarPreferenciasNotificacoes(s, await corpoNotificacoes(req, zPreferencias)));
});
