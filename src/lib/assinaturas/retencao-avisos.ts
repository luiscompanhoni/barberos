/**
 * Avisos do cancelamento/retencao: cliente no WhatsApp, dono no WhatsApp e
 * conversa passada para a equipe (gerente).
 */
import { db } from "@/lib/db";
import { publicar } from "@/lib/eventos";
import { notificarEmSegundoPlano, obterConversa } from "@/lib/whatsapp/conversas";

const reais = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const dataBr = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
export { reais };

/** Manda para todos os donos ativos. */
export async function avisarDono(texto: string) {
  const donos = await db.usuario.findMany({ where: { papel: "DONO", ativo: true }, select: { telefone: true } });
  for (const d of donos) notificarEmSegundoPlano(d.telefone, texto);
  return donos.length;
}

export function avisarCliente(telefone: string, texto: string) {
  notificarEmSegundoPlano(telefone, texto);
}

/** Conversa do cliente vai para a equipe responder (painel Conversas) com uma nota do motivo. */
export async function passarConversaParaEquipe(telefone: string, nota: string) {
  const conversa = await obterConversa(telefone);
  await db.conversa.update({ where: { id: conversa.id }, data: { estado: "HUMANO" } });
  await db.mensagem.create({ data: { conversaId: conversa.id, autor: "NOTA", texto: nota } });
  publicar({ tipo: "conversa", conversaId: conversa.id });
  return conversa.id;
}
