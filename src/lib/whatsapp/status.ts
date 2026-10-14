/**
 * Entregue / lida / falhou nas mensagens que a barbearia mandou (webhook da API oficial e da Evolution).
 * So avanca: lida implica entregue; a primeira data vale.
 */
import { db } from "@/lib/db";
import type { StatusMensagem } from "./webhook";

export async function registrarStatus(lista: StatusMensagem[]) {
  for (const s of lista) {
    const quando = new Date(s.quando ?? Date.now());
    if (s.status === "FALHOU") {
      await db.mensagem.updateMany({ where: { wamid: s.wamid, erro: null }, data: { erro: s.erro ?? "O WhatsApp não entregou a mensagem." } });
      continue;
    }
    await db.mensagem.updateMany({ where: { wamid: s.wamid, entregueEm: null }, data: { entregueEm: quando } });
    if (s.status === "LIDA") await db.mensagem.updateMany({ where: { wamid: s.wamid, lidaEm: null }, data: { lidaEm: quando } });
  }
}
