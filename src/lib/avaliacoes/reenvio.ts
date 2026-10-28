import { auditar } from "@/lib/auditoria";
import { configuracao } from "@/lib/agenda/carregar";
import type { Sessao } from "@/lib/auth/sessao";
import { enviarAutomacao } from "@/lib/automacoes/enviar";
import { horarioComercial } from "@/lib/automacoes/regras";
import { db } from "@/lib/db";
import { urlSite } from "@/lib/dominios";
import { ErroNegocio, proibido } from "@/lib/erros";
import { falhaSemEnvioConfirmado } from "./regras";

/** Reenvio é explícito do dono e somente quando o erro comprova ausência de chamada ao provedor. */
export async function reenviarConvitesSemSaida(s: Sessao, agora = new Date()) {
  if (s.papel !== "DONO") throw proibido();
  const cfg = await db.avaliacaoConfig.findUnique({ where: { id: 1 } });
  if (!cfg?.ativo || !cfg.whatsapp) throw new ErroNegocio("Ative os convites e seu envio pelo WhatsApp antes de tentar novamente.");
  if (!horarioComercial(agora.getTime(), (await configuracao()).fuso)) throw new ErroNegocio("Tente novamente no horário comercial da barbearia.");
  const registros = await db.automacaoEnviada.findMany({ where: { tipo: "AVALIACAO" }, orderBy: { criadoEm: "desc" } });
  const ultimos = new Map<string, (typeof registros)[number]>();
  for (const r of registros) {
    const conviteId = r.chave.split(":retry:")[0];
    if (!ultimos.has(conviteId)) ultimos.set(conviteId, r);
  }
  const elegiveis = [...ultimos].filter(([, r]) => !r.ok && falhaSemEnvioConfirmado(r.erro)).map(([id]) => id);
  const convites = await db.conviteAvaliacao.findMany({ where: {
    id: { in: elegiveis },
    respondidaEm: null, expiraEm: { gt: agora }, cliente: { aceitaMensagens: true },
  }, include: { cliente: { select: { telefone: true } } }, take: 100 });
  let tentativas = 0;
  for (const convite of convites) {
    const prefixo = `${convite.id}:retry:`;
    const envios = await db.automacaoEnviada.findMany({ where: { tipo: "AVALIACAO", OR: [{ chave: convite.id }, { chave: { startsWith: prefixo } }] }, orderBy: { criadoEm: "desc" } });
    const ultimo = envios[0];
    if (!ultimo || ultimo.ok || !falhaSemEnvioConfirmado(ultimo.erro)) continue;
    const chave = `${prefixo}${envios.length}`;
    await db.$transaction(tx => auditar(tx, s.usuarioId, "reenviar_convite_sem_saida", "convite_avaliacao", convite.id, { chave }));
    if (await enviarAutomacao({ tipo: "AVALIACAO", chave, clienteId: convite.clienteId, agendamentoId: convite.agendamentoId,
      telefone: convite.cliente.telefone,
      texto: `Como foi sua primeira visita? Seu nome não será mostrado ao barbeiro; a administração autorizada pode consultar sua avaliação. ${convite.jogoId ? "Qualquer nota válida libera uma jogada. " : ""}Avalie pelo aplicativo: ${urlSite()}/c/avaliacoes`,
    })) tentativas++;
  }
  return { tentativas, mensagem: `${tentativas} tentativa(s) registrada(s). Falhas de entrega incerta não foram reenviadas. O convite continua no aplicativo.` };
}
