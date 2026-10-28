import { configuracao } from "@/lib/agenda/carregar";
import { enviarAutomacao } from "@/lib/automacoes/enviar";
import { horarioComercial } from "@/lib/automacoes/regras";
import { db } from "@/lib/db";
import { urlSite } from "@/lib/dominios";
import { configuracaoAvaliacao } from "./configuracao";
import { assegurarConvitePrimeiraVisita } from "./convites";

/** Reserva única no mecanismo existente impede duplicação. Falhas ficam visíveis à gestão. */
export async function processarConvitesAvaliacao(opts: { clienteIds?: string[] } = {}, agora = new Date()) {
  const cfg = await configuracaoAvaliacao();
  if (!cfg.ativo || !cfg.ativaDesde) return 0;
  const clientes = await db.agendamento.findMany({ where: {
    status: "CONCLUIDO", adicionalDeId: null, fim: { gte: cfg.ativaDesde, lte: agora },
    ...(opts.clienteIds ? { clienteId: { in: opts.clienteIds } } : {}),
    cliente: { conviteAvaliacao: null, agendamentos: { none: { status: "CONCLUIDO", adicionalDeId: null, fim: { lt: cfg.ativaDesde } } } },
  }, distinct: ["clienteId"], select: { clienteId: true }, take: 200 });
  for (const c of clientes) await assegurarConvitePrimeiraVisita(c.clienteId, agora);
  const fuso = (await configuracao()).fuso;
  if (!cfg.whatsapp || !horarioComercial(agora.getTime(), fuso)) return 0;
  const registrados = await db.automacaoEnviada.findMany({ where: { tipo: "AVALIACAO" }, select: { chave: true } });
  const convites = await db.conviteAvaliacao.findMany({ where: {
    id: { notIn: registrados.map(e => e.chave) },
    respondidaEm: null, expiraEm: { gt: agora }, cliente: { aceitaMensagens: true },
    ...(opts.clienteIds ? { clienteId: { in: opts.clienteIds } } : {}),
  }, include: { cliente: { select: { telefone: true } } }, orderBy: { criadoEm: "asc" }, take: 100 });
  let enviados = 0;
  for (const c of convites) {
    if (await enviarAutomacao({ tipo: "AVALIACAO", chave: c.id, clienteId: c.clienteId, agendamentoId: c.agendamentoId,
      telefone: c.cliente.telefone, texto: `Como foi sua primeira visita? Sua avaliação fica dentro da barbearia e seu nome não é mostrado ao barbeiro. A administração autorizada pode consultar a origem. ${c.jogoId ? "Qualquer nota válida libera uma jogada. " : ""}Avalie pelo aplicativo: ${urlSite()}/c/avaliacoes`,
    })) enviados++;
  }
  return enviados;
}
