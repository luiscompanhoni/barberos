import { setTimeout as esperar } from "node:timers/promises";
import { configuracao } from "@/lib/agenda/carregar";
import { db } from "@/lib/db";
import { provedorWhatsApp, temJanela24h } from "@/lib/whatsapp/canal";
import { notificarCliente } from "@/lib/whatsapp/conversas";
import { testeEquipeAtivo } from "@/lib/whatsapp/teste-equipe";
import { enviarAutomacao } from "./enviar";
import { aberturaReativacao } from "./regras";

export function canalDaReativacaoAtivo(botAtivo: boolean) {
  return botAtivo && !testeEquipeAtivo() && process.env.WHATSAPP_ENVIOS_BLOQUEADOS !== "true" &&
    (provedorWhatsApp() === "simulador" || process.env.WHATSAPP_ATENDIMENTO_IA_PAGA === "true");
}

/** A próxima etapa só é tratada pelo bot quando chegar uma mensagem do cliente. */
export async function iniciarReativacao(cliente: { id: string; nome: string; telefone: string }, visita: Date, agora: number) {
  const conversa = await db.conversa.findUnique({ where: { telefone: cliente.telefone },
    select: { estado: true, recusaAutomaticas: true, ultimaEntradaEm: true } });
  if (conversa?.estado === "HUMANO" || conversa?.recusaAutomaticas) return false;
  if (temJanela24h() && (!conversa?.ultimaEntradaEm || Date.now() - +conversa.ultimaEntradaEm >= 24 * 3_600_000)) return false;
  const [ola, apresentacao] = aberturaReativacao(cliente.nome);
  const opcoes = { apenasTextoLivre: true, pararSeHumano: true };
  return enviarAutomacao({ tipo: "REATIVACAO", chave: `${cliente.id}:${visita.toISOString()}`,
    clienteId: cliente.id, telefone: cliente.telefone, texto: ola }, async () => {
    const primeiro = await notificarCliente(cliente.telefone, ola, opcoes);
    if (!primeiro.ok) return primeiro;
    if (provedorWhatsApp() !== "simulador") await esperar(2000);
    const [atual, titular, futura, cfg] = await Promise.all([
      db.conversa.findUnique({ where: { telefone: cliente.telefone },
        select: { estado: true, recusaAutomaticas: true, ultimaEntradaEm: true } }),
      db.cliente.findFirst({ where: { id: cliente.id, telefone: cliente.telefone, aceitaMensagens: true, excluidoEm: null }, select: { id: true } }),
      db.agendamento.findFirst({ where: { clienteId: cliente.id, status: { in: ["MARCADO", "CONFIRMADO"] }, inicio: { gt: new Date(agora) } }, select: { id: true } }),
      configuracao(),
    ]);
    if (!atual || atual.estado !== "BOT" || atual.recusaAutomaticas || !titular || futura ||
      atual.ultimaEntradaEm?.getTime() !== conversa?.ultimaEntradaEm?.getTime() || !canalDaReativacaoAtivo(cfg.botAtivo)) return primeiro;
    return notificarCliente(cliente.telefone, apresentacao, opcoes);
  });
}
