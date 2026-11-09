/** Reenvio solicitado pelo titular: consulta a fatura existente, sem emitir ou cobrar novamente. */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { dataLocal } from "@/lib/agenda/tempo";
import { gatewayPorId } from "@/lib/pagamentos/gateway";
import { gatewayConfere, type SnapshotCobranca } from "./cobranca-automatica";
import { linkAbsoluto } from "./cobrancas";

const incluir = { assinatura: { include: { cliente: { select: { telefone: true, excluidoEm: true } } } }, vinculosExternos: { select: { id: true } } } as const;
type Registro = Prisma.CobrancaGetPayload<{ include: typeof incluir }>;

function snapshot(c: Registro): SnapshotCobranca {
  return {
    cobrancaId: c.id, gatewayId: c.gatewayId, assinaturaGatewayId: c.assinatura.gatewayId,
    status: c.status, forma: c.forma, link: c.link, tokenPublico: c.tokenPublico,
    valorCentavos: c.valorCentavos, vencimento: c.vencimento.toISOString().slice(0, 10),
    expiraEm: c.expiraEm ? +c.expiraEm : null, clienteId: c.assinatura.clienteId, telefone: c.assinatura.cliente.telefone,
  };
}

function precisaRevisao(c: Registro, hoje: string) {
  return !["PENDENTE", "ATRASADA"].includes(c.status) || !!c.pagaEm || !!c.vinculosExternos.length
    || c.assinatura.status === "CANCELADA" || !!c.assinatura.operacaoInicial || !!c.assinatura.pausadaEm || !!c.assinatura.encerraEm
    || !!c.assinatura.cliente.excluidoEm || c.assinatura.formaPagamento === "CARTAO" || c.forma === "CARTAO"
    || (c.forma === "BOLETO" && c.vencimento.toISOString().slice(0, 10) < hoje);
}

/** Aceite de campanha é separado: este método só consulta e não envia mensagens. */
export async function linkDaMensalidadeParaAtendimento(clienteId: string, cobrancaId: string, agora = new Date()) {
  const revisao = { link: null, em_conferencia: true, orientacao: "A equipe precisa conferir a cobrança. Não emitir nova assinatura, não pedir outro pagamento nem afirmar dívida confirmada." } as const;
  const c = await db.cobranca.findFirst({ where: { id: cobrancaId, assinatura: { clienteId } }, include: incluir });
  if (!c) return revisao;
  const fuso = (await db.configuracao.findUnique({ where: { id: 1 }, select: { fuso: true } }))?.fuso ?? "America/Sao_Paulo";
  if (precisaRevisao(c, dataLocal(+agora, fuso))) return revisao;
  const s = snapshot(c);
  try {
    const remota = await (await gatewayPorId(c.gatewayId)).buscarCobranca(c.gatewayId);
    if (!gatewayConfere(s, remota, new Date())) return revisao;
    // Um webhook pode liquidar ou alterar a fatura enquanto o gateway responde.
    const atual = await db.cobranca.findFirst({ where: { id: cobrancaId, assinatura: { clienteId } }, include: incluir });
    if (!atual || precisaRevisao(atual, dataLocal(Date.now(), fuso)) || JSON.stringify(snapshot(atual)) !== JSON.stringify(s)) return revisao;
    const duplicadas = await db.cobranca.count({ where: { assinaturaId: atual.assinaturaId, vencimento: atual.vencimento, valorCentavos: atual.valorCentavos, status: { not: "CANCELADA" } } });
    if (duplicadas > 1 || !gatewayConfere(s, remota, new Date())) return revisao;
    return { link: linkAbsoluto(atual.link), em_conferencia: false, orientacao: "Reenvie este link existente somente se o cliente pediu. Não há nova emissão nem confirmação de pagamento." };
  } catch {
    return revisao;
  }
}
