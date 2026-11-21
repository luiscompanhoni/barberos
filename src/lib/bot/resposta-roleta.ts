import type { Conversa } from "@prisma/client";
import { db } from "@/lib/db";
import { urlSite } from "@/lib/dominios";
import { dentroJanela24h, temJanela24h } from "@/lib/whatsapp/canal";
import { enviarNaConversa } from "@/lib/whatsapp/conversas";
import { classificarRespostaAbertura, RECUSA_CONVITE } from "./convite-app-textos";

export const NOTA_UPSELL = "Quer deixar o próximo corte marcado depois da roleta.";

/** Responder à retomada pode levar direto ao horário, com o prêmio disponível da mesma jogada. */
export async function responderNudgeRoleta(
  conversa: Pick<Conversa, "id" | "clienteId" | "ultimaEntradaEm">,
  jogadaId: string,
  texto: string,
  aindaComBot: () => Promise<boolean>,
) {
  const resposta = classificarRespostaAbertura(texto);
  if (!resposta || !conversa.clienteId) return false;
  let mensagem = RECUSA_CONVITE;
  if (resposta === "acolheu") {
    const premio = await db.premioGanho.findFirst({ where: {
      jogadaId, clienteId: conversa.clienteId, status: "DISPONIVEL", tipo: { not: "CREDITO" },
      OR: [{ expiraEm: null }, { expiraEm: { gt: new Date() } }],
    }, orderBy: { id: "asc" }, select: { id: true } });
    const agenda = new URL("/c/agendar", urlSite());
    if (premio) agenda.searchParams.set("premio", premio.id);
    mensagem = `Bora! Tu consegue escolher teu horário por aqui 👇\n${agenda}`;
  }
  if (!await aindaComBot() || (temJanela24h() && !dentroJanela24h(conversa.ultimaEntradaEm))) return false;
  return (await enviarNaConversa(conversa.id, mensagem, "BOT", { respostaAtendimento: true, pararSeHumano: true })).ok;
}
