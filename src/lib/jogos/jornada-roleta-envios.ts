import type { Configuracao, Prisma } from "@prisma/client";
import { enviarAutomacao, type Envio } from "@/lib/automacoes/enviar";
import { horarioComercial } from "@/lib/automacoes/regras";
import { db } from "@/lib/db";
import { quarentenaRestauracao } from "@/lib/recuperacao/quarentena";
import { provedorWhatsApp, temJanela24h } from "@/lib/whatsapp/canal";
import { notificarCliente } from "@/lib/whatsapp/conversas";
import { naFila } from "@/lib/whatsapp/fila-conversa";
import { recursoPiloto } from "@/lib/whatsapp/piloto-regras";
import { travarPreferencia } from "@/lib/whatsapp/preferencia";
import { testeEquipeAtivo } from "@/lib/whatsapp/teste-equipe";
import { telefoneCanonico } from "@/lib/whatsapp/webhook";
import { acompanhamentoRoletaAtivo, HORA, registrarEnvioRoleta } from "./jornada-roleta";

export type DestinoRoleta = { id: string; telefone: string };
type Janela = { ultimaEntradaEm: Date | null } | null;

export function canalDaTrilhaRoleta(cfg: Pick<Configuracao, "botAtivo" | "fuso">, agora: number) {
  return acompanhamentoRoletaAtivo() && cfg.botAtivo && horarioComercial(agora, cfg.fuso) &&
    !quarentenaRestauracao() && !recursoPiloto() && !testeEquipeAtivo() && process.env.WHATSAPP_ENVIOS_BLOQUEADOS !== "true";
}

export function janelaDaTrilha(conversa: Janela, agora: number, permiteModelo = false) {
  return !temJanela24h() || (!!conversa?.ultimaEntradaEm && +conversa.ultimaEntradaEm <= agora &&
    agora - +conversa.ultimaEntradaEm < 24 * HORA) || (permiteModelo && !!process.env.WHATSAPP_TEMPLATE_AVISO?.trim());
}

/** As mudanças de titular e de preferência usam as mesmas travas. Releia o contato antes do transporte. */
export function comContatoRoleta(
  destino: DestinoRoleta, cfg: Pick<Configuracao, "botAtivo" | "fuso">, agora: number, permiteModelo: boolean,
  executar: (tx: Prisma.TransactionClient) => Promise<boolean>,
) {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cliente-ciclo:${destino.id}`}))`;
    await travarPreferencia(tx, destino.telefone);
    const instante = Math.max(agora, Date.now());
    const config = await tx.configuracao.findUnique({ where: { id: 1 }, select: { botAtivo: true, fuso: true } });
    if (!canalDaTrilhaRoleta(config ?? cfg, instante)) return false;
    const c = await tx.cliente.findFirst({ where: {
      id: destino.id, telefone: destino.telefone, aceitaMensagens: true, excluidoEm: null,
    }, select: { conversa: { select: { telefone: true, waId: true, ultimaEntradaEm: true, estado: true, recusaAutomaticas: true } } } });
    const conversa = c?.conversa;
    if (!c || (conversa && (conversa.telefone !== destino.telefone || conversa.estado !== "BOT" ||
      conversa.recusaAutomaticas || (conversa.waId && telefoneCanonico(conversa.waId) !== destino.telefone)))) return false;
    // Uma recusa ou um atendimento humano pode anteceder o vínculo do cadastro com a conversa.
    const semVinculo = !conversa && await tx.conversa.findUnique({ where: { telefone: destino.telefone }, select: { id: true } });
    if (semVinculo || !janelaDaTrilha(conversa ?? null, instante, permiteModelo)) return false;
    return executar(tx);
  }, { maxWait: 10_000, timeout: 60_000 });
}

export async function notificarRoleta(telefone: string, texto: string, permiteModelo = false) {
  const r = await notificarCliente(telefone, texto, { apenasTextoLivre: !permiteModelo, pararSeHumano: true });
  return r.ok && (provedorWhatsApp() === "simulador" || ("wamid" in r && !!r.wamid))
    ? r : { ...r, ok: false, erro: r.erro ?? "Canal não confirmou o envio." };
}

export function enviarLembreteRoleta(envio: Envio & { agendamentoId: string }, cfg: Configuracao, agora: number, inicio: Date) {
  return naFila(envio.telefone, () => comContatoRoleta({ id: envio.clienteId, telefone: envio.telefone }, cfg, agora, true, async tx => {
    const vigente = await tx.agendamento.findFirst({ where: {
      id: envio.agendamentoId, clienteId: envio.clienteId, inicio, status: { in: ["MARCADO", "CONFIRMADO"] },
    }, select: { id: true } });
    if (!vigente || +inicio <= Date.now()) return false;
    if (!await enviarAutomacao(envio, () => notificarRoleta(envio.telefone, envio.texto, true))) return false;
    await registrarEnvioRoleta(envio.agendamentoId, "lembreteEnviadoEm", agora, tx);
    return true;
  }));
}
