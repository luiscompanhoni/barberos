import { Prisma, type TipoAutomacao } from "@prisma/client";
import { db } from "@/lib/db";
import { registrarEnvioRoleta } from "@/lib/jogos/jornada-roleta";
import { provedorWhatsApp } from "@/lib/whatsapp/canal";
import { notificarCliente } from "@/lib/whatsapp/conversas";

export type Envio = { tipo: TipoAutomacao; chave: string; clienteId: string; agendamentoId?: string | null; telefone: string; texto: string };

async function entregarAviso(e: Envio) {
  const r = await notificarCliente(e.telefone, e.texto);
  if (!e.agendamentoId || !r?.ok || (provedorWhatsApp() !== "simulador" && !("wamid" in r && r.wamid))) return r;
  const campo = e.tipo === "POS_ATENDIMENTO" ? "posEnviadoEm"
    : e.tipo === "LEMBRETE_VESPERA" || e.tipo === "LEMBRETE_PROXIMO" ? "lembreteEnviadoEm" : null;
  if (campo) await registrarEnvioRoleta(e.agendamentoId, campo, Date.now())
    .catch(() => console.error("[roleta] Falha ao medir aviso confirmado."));
  return r;
}

/**
 * Reserva o envio (linha unica tipo + chave) e manda no WhatsApp. Devolve false se ja tinha saido.
 * Falha de envio fica registrada na linha (aparece no historico das automacoes).
 */
export async function enviarAutomacao(e: Envio, entregar = () => entregarAviso(e)) {
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
    const r = await entregar();
    const erro = r && typeof r === "object" && "erro" in r ? (r.erro as string | null) : null;
    if (erro || (r && typeof r === "object" && "ok" in r && r.ok === false)) {
      await db.automacaoEnviada.update({ where: { id }, data: { ok: false, erro: erro ?? "Canal não confirmou o envio." } });
      return false;
    }
  } catch (err) {
    await db.automacaoEnviada.update({ where: { id }, data: { ok: false, erro: (err as Error).message.slice(0, 300) } });
    return false;
  }
  return true;
}
