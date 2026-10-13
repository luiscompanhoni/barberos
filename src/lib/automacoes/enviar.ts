import { Prisma, type TipoAutomacao } from "@prisma/client";
import { db } from "@/lib/db";
import { notificarCliente } from "@/lib/whatsapp/conversas";

export type Envio = { tipo: TipoAutomacao; chave: string; clienteId: string; agendamentoId?: string | null; telefone: string; texto: string };

/**
 * Reserva o envio (linha unica tipo + chave) e manda no WhatsApp. Devolve false se ja tinha saido.
 * Falha de envio fica registrada na linha (aparece no historico das automacoes).
 */
export async function enviarAutomacao(e: Envio) {
  let id: string;
  try {
    id = (await db.automacaoEnviada.create({
      data: { tipo: e.tipo, chave: e.chave, clienteId: e.clienteId, agendamentoId: e.agendamentoId ?? null },
    })).id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return false;
    throw err;
  }
  try {
    const r = await notificarCliente(e.telefone, e.texto);
    const erro = r && typeof r === "object" && "erro" in r ? (r.erro as string | null) : null;
    if (erro) await db.automacaoEnviada.update({ where: { id }, data: { ok: false, erro } });
  } catch (err) {
    await db.automacaoEnviada.update({ where: { id }, data: { ok: false, erro: (err as Error).message.slice(0, 300) } });
  }
  return true;
}
