/**
 * Parte da rotina horaria: reativa pausas vencidas e encerra planos cancelados
 * no fim do ciclo pago.
 */
import { db } from "@/lib/db";
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal } from "@/lib/agenda/tempo";
import { aplicarPlanoAosFuturos } from "./agenda";
import { cancelar } from "./servico";
import { avisarCliente, dataBr } from "./retencao-avisos";

/** Pausa acabou: o plano volta a valer (a cobranca ja foi empurrada quando pausou). */
export async function reativarPausas() {
  const cfg = await configuracao();
  const hoje = new Date(`${dataLocal(Date.now(), cfg.fuso)}T00:00:00Z`);
  const lista = await db.assinatura.findMany({
    where: { pausadaEm: { not: null }, pausadaAte: { lte: hoje }, status: { not: "CANCELADA" } },
    include: { cliente: true, plano: true },
  });
  for (const a of lista) {
    // So reativa uma vez (corrida entre duas rotinas).
    const r = await db.assinatura.updateMany({ where: { id: a.id, pausadaEm: { not: null } }, data: { pausadaEm: null } });
    if (!r.count) continue;
    await aplicarPlanoAosFuturos(a.clienteId, cfg.fuso).catch((e) => console.error("[rotina] plano nos futuros:", e));
    const venc = a.proximoVencimento ? ` A próxima mensalidade é em ${dataBr(a.proximoVencimento.toISOString())}.` : "";
    avisarCliente(a.cliente.telefone, `Oi, ${a.cliente.nome.split(" ")[0]}! Seu ${a.plano.nome} voltou a valer hoje ▶️ Já pode marcar seu horário.${venc}`);
  }
  return lista.length;
}

/** Cancelado no fim do ciclo: no dia do fim, vira CANCELADA (horarios seguintes viram avulsos). */
export async function encerrarCancelados() {
  const cfg = await configuracao();
  const hoje = new Date(`${dataLocal(Date.now(), cfg.fuso)}T00:00:00Z`);
  const lista = await db.assinatura.findMany({
    where: { encerraEm: { lte: hoje }, status: { not: "CANCELADA" } },
    include: { cliente: true, plano: true },
  });
  for (const a of lista) {
    try {
      await cancelar(a.id, a.motivoCancelamento ?? "Cancelado pelo cliente", null, { avisar: false, semGateway: true });
      avisarCliente(a.cliente.telefone,
        `Oi, ${a.cliente.nome.split(" ")[0]}! Hoje terminou o período do seu ${a.plano.nome}. Obrigado por ter sido assinante! Quando quiser voltar, é só chamar aqui. 💈`);
    } catch (e) {
      console.error(`[rotina] encerrar assinatura ${a.id}:`, e);
    }
  }
  return lista.length;
}
