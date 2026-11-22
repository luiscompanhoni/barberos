/**
 * Entregue / lida / falhou nas mensagens que a barbearia mandou (webhook da API oficial e da Evolution).
 * So avanca: lida implica entregue; a primeira data vale.
 */
import { db } from "@/lib/db";
import { instanteDeAjudaAposLeitura } from "@/lib/convites/jornada-leonel";
import type { StatusMensagem } from "./webhook";

export async function registrarStatus(lista: StatusMensagem[]) {
  for (const s of lista) {
    const quando = new Date(s.quando ?? Date.now());
    if (s.status === "FALHOU") {
      await db.mensagem.updateMany({ where: { wamid: s.wamid, erro: null }, data: { erro: s.erro ?? "O WhatsApp não entregou a mensagem." } });
      continue;
    }
    await db.mensagem.updateMany({ where: { wamid: s.wamid, entregueEm: null }, data: { entregueEm: quando } });
    if (s.status === "LIDA") await db.$transaction(async tx => {
      const leitura = await tx.mensagem.updateMany({ where: { wamid: s.wamid, lidaEm: null }, data: { lidaEm: quando } });
      if (!leitura.count) return;
      const mensagem = await tx.mensagem.findUniqueOrThrow({ where: { wamid: s.wamid }, select: { id: true, criadoEm: true, erro: true } });
      if (mensagem.erro) return;
      await tx.jornadaConviteApp.updateMany({
        where: { linkId: mensagem.id, OR: ["appq", "appm", "rotf", "rotm"].map(prefixo => ({ token: { startsWith: prefixo } })), parouEm: null,
          retomadas: 0, proximaEm: { not: null }, respostaEm: null, clicouEm: null, loginEm: null, entrouEm: null,
          conversa: { estado: "BOT", recusaAutomaticas: false } },
        data: { proximaEm: instanteDeAjudaAposLeitura(mensagem.criadoEm, quando) },
      });
    });
  }
}
