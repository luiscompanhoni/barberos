import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { exigirOrigemCliente } from "@/lib/auth/http-cliente";
import { sessaoAtual } from "@/lib/auth/sessao";
import { tokenDeConvite } from "@/lib/convites/link";
import { db } from "@/lib/db";
import { cookieSeguro } from "@/lib/dominios";
import { rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";
import { limitar } from "@/lib/limite";

const etapas = { clique: "clicouEm", login: "loginEm", entrou: "entrouEm", agenda: "agendaEm", instalou: "instalouEm" } as const;
const cookie = "black_convite_app";
export const POST = rota(async (req: NextRequest) => {
  exigirOrigemCliente(req);
  const { evento, token: recebido } = await corpo(req, z.object({
    evento: z.enum(["clique", "login", "entrou", "agenda", "instalou"]), token: z.string().max(40).optional(),
  }).strict(), { maxBytes: 1024, tipoJson: true });
  const token = evento === "clique" ? recebido : req.cookies.get(cookie)?.value;
  const resposta = new NextResponse(null, { status: 204 });
  if (!token || !tokenDeConvite(token)) return resposta;
  limitar("convite-visita:" + (req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? "?"), 180, 60_000);
  const s = await sessaoAtual();
  if ((evento === "entrou" || evento === "agenda") && !s?.clienteId) return resposta;
  if (s && s.papel !== "CLIENTE") return resposta;
  const campo = etapas[evento];
  const jornada = await db.jornadaConviteApp.findUnique({ where: { token },
    select: { clienteId: true, linkId: true, inicioEm: true, conversa: { select: { clienteId: true } } } });
  if (!jornada?.linkId || jornada.clienteId !== jornada.conversa.clienteId || (s && s.clienteId !== jornada.clienteId) ||
      +jornada.inicioEm < Date.now() - 30 * 86_400_000) return resposta;
  await db.$transaction(async tx => {
    const primeiro = await tx.jornadaConviteApp.updateMany({ where: { token, [campo]: null }, data: { [campo]: new Date() } });
    if (primeiro.count && ["clique", "login", "entrou"].includes(evento)) {
      await tx.$executeRaw`UPDATE jornadas_convite_app SET "proximaEm"=GREATEST(now()+interval '4 hours',"ultimaRetomadaEm"+interval '24 hours')
        WHERE token=${token} AND "parouEm" IS NULL AND "proximaEm" IS NOT NULL AND retomadas<3 AND "agendaEm" IS NULL`;
    }
  });
  if (evento === "clique") resposta.cookies.set(cookie, token, { path: "/", maxAge: 30 * 86400, httpOnly: true, secure: cookieSeguro(), sameSite: "lax" });
  return resposta;
});
