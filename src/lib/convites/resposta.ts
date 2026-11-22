import type { JornadaConviteApp } from "@prisma/client";
import { db } from "@/lib/db";
import { recusouJornada } from "./jornada-leonel";
import { destinoDaJornada, ehJornadaComRoleta, ehJornadaLeonel } from "./link";

async function registrarRespostaDaJornada(jornada: Pick<JornadaConviteApp, "conversaId" | "respostaEm">, entrada: Date | null, texto: string) {
  const recusou = recusouJornada(texto);
  if (entrada && (recusou || !jornada.respostaEm)) {
    await db.jornadaConviteApp.updateMany({ where: { conversaId: jornada.conversaId, parouEm: null }, data: {
      respostaEm: jornada.respostaEm ?? entrada, ...(recusou ? { parouEm: entrada, proximaEm: null } : {}),
    } });
  }
  return recusou;
}


export async function contextoDaJornada(jornada: JornadaConviteApp | null, entrada: Date | null, texto: string, sinal: AbortSignal) {
  if (!jornada?.linkId || jornada.parouEm) return {};
  const nova = ehJornadaLeonel(jornada.token);
  if (nova && !sinal.aborted && await registrarRespostaDaJornada(jornada, entrada, texto)) return {};
  const etapaNoApp = jornada.agendaEm ? "agenda" : jornada.entrouEm ? "conta" :
    jornada.loginEm ? "login" : jornada.clicouEm ? "acesso ao link" : "link enviado";
  return {
    etapaNoApp,
    linkDaJornada: nova ? destinoDaJornada(jornada.token) : undefined,
    roletaDaJornada: nova && ehJornadaComRoleta(jornada.token),
  };
}
