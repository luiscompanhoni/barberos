import { NextResponse } from "next/server";
import { z } from "zod";
import { EQUIPE, exigirSessao } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { gravarCookieDispositivo, revogarDispositivoAtual, revogarInscricaoPush, salvarInscricaoPush, tokenDoDispositivo, zInscricaoPush } from "@/lib/notificacoes/inscricoes";
import { corpoNotificacoes, exigirOrigemNotificacoes } from "@/lib/notificacoes/seguranca";

export const POST = rota(async (req: Request) => {
  const origem = exigirOrigemNotificacoes(req);
  const s = await exigirSessao([...EQUIPE, "CLIENTE"]);
  const r = await salvarInscricaoPush(s, await corpoNotificacoes(req, zInscricaoPush), origem, await tokenDoDispositivo());
  await gravarCookieDispositivo(r.token);
  return NextResponse.json({ ok: true, id: r.id }, { status: 201 });
});

export const DELETE = rota(async (req: Request) => {
  exigirOrigemNotificacoes(req);
  const s = await exigirSessao([...EQUIPE, "CLIENTE"]);
  const b = await corpoNotificacoes(req, z.object({ id: z.string().min(1).max(40).optional() }).strict(), true);
  if (b.id) await revogarInscricaoPush(s.usuarioId, await tokenDoDispositivo(), b.id);
  else await revogarDispositivoAtual(s.usuarioId);
  return NextResponse.json({ ok: true });
});
