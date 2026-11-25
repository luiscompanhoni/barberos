/**
 * Contratos da Celcoin que o BarberOS não emitiu (planos vendidos pelo CashBarber).
 * O webhook só avisa: a posição vem sempre da consulta à API. Guarda a parcela mais recente de cada
 * contrato para a equipe ver no cartão do cliente. Não altera assinatura, cobrança ou acesso e não envia mensagem.
 */
import { FalhaSincronizacaoAssinatura } from "@/lib/assinaturas/eventos";
import { auditar } from "@/lib/auditoria";
import { db } from "@/lib/db";
import { normalizarTelefone } from "@/lib/telefone";
import { consultarParcelaComContrato, PREFIXO } from "./celcash";

type Titular = { cpf: string; telefones: string[] };

/** Só liga ao cadastro quando o CPF (ou, na falta dele, o telefone) aponta para um único cliente. */
async function clienteDoTitular(t: Titular) {
  const cpf = t.cpf.replace(/\D/g, "");
  if (cpf.length === 11) {
    const formatado = `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
    const achados = await db.cliente.findMany({ where: { excluidoEm: null, cpf: { in: [cpf, formatado] } }, select: { id: true }, take: 2 });
    if (achados.length === 1) return { clienteId: achados[0].id, vinculo: "CPF" };
    if (achados.length > 1) return { clienteId: null, vinculo: "AMBIGUO" };
  }
  const telefones = new Set<string>();
  for (const bruto of t.telefones) {
    const tel = normalizarTelefone(bruto);
    if (!tel) continue;
    telefones.add(tel);
    // Cadastro antigo sem o nono dígito na Celcoin.
    if (tel.length === 12 && /[6-9]/.test(tel[4])) telefones.add(`${tel.slice(0, 4)}9${tel.slice(4)}`);
  }
  if (!telefones.size) return { clienteId: null, vinculo: "SEM_VINCULO" };
  const achados = await db.cliente.findMany({ where: { excluidoEm: null, telefone: { in: [...telefones] } }, select: { id: true }, take: 2 });
  if (achados.length === 1) return { clienteId: achados[0].id, vinculo: "TELEFONE" };
  return { clienteId: null, vinculo: achados.length ? "AMBIGUO" : "SEM_VINCULO" };
}

/**
 * Trata o aviso de uma parcela. Devolve false quando a parcela é de uma cobrança ou assinatura
 * do próprio BarberOS (ou avulsa): nesse caso o fluxo normal de assinaturas decide.
 */
export async function atualizarContratoExterno(cobrancaGatewayId: string): Promise<boolean> {
  if (!cobrancaGatewayId.startsWith(PREFIXO.transacao)) return false;
  if (await db.cobranca.findUnique({ where: { gatewayId: cobrancaGatewayId }, select: { id: true } })) return false;
  let lida: Awaited<ReturnType<typeof consultarParcelaComContrato>>;
  // Celcoin fora do ar: o aviso fica pendente e a rotina consulta de novo, em vez de travar em revisão.
  try { lida = await consultarParcelaComContrato(cobrancaGatewayId); }
  catch { throw new FalhaSincronizacaoAssinatura(true); }
  if (!lida?.contratoId) return false;
  const { parcela, contratoId, statusCelcoin, titular } = lida;
  if (await db.assinatura.findUnique({ where: { gatewayId: `${PREFIXO.assinatura}${contratoId}` }, select: { id: true } })) return false;
  if (parcela.id !== cobrancaGatewayId || !parcela.vencimentoConfirmado) throw new Error("Parcela da Celcoin sem dados conferíveis.");

  const transacaoId = cobrancaGatewayId.slice(PREFIXO.transacao.length);
  const posicao = {
    transacaoId, valorCentavos: parcela.valorCentavos, statusCelcoin, situacao: parcela.status,
    vencimento: new Date(`${parcela.vencimento}T00:00:00Z`), pagoEm: parcela.pagaEm ? new Date(parcela.pagaEm) : null,
  };
  const dono = await clienteDoTitular(titular);
  await db.$transaction(async (tx) => {
    // Parcelas diferentes do mesmo contrato chegam em filas separadas: a trava é por contrato.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contrato-celcoin:${contratoId}`}, 0))`;
    const atual = await tx.contratoCelcoin.findUnique({ where: { id: contratoId } });
    // Aviso de parcela antiga não sobrescreve a mais recente.
    if (atual && atual.transacaoId !== transacaoId && atual.vencimento > posicao.vencimento) return;
    const resumo = (c: typeof posicao & { clienteId: string | null }) => ({
      transacaoId: c.transacaoId, valorCentavos: c.valorCentavos, statusCelcoin: c.statusCelcoin, situacao: c.situacao,
      vencimento: c.vencimento.toISOString().slice(0, 10), pagoEm: c.pagoEm?.toISOString() ?? null, clienteId: c.clienteId,
    });
    const depois = resumo({ ...posicao, clienteId: dono.clienteId });
    // Repetição do mesmo aviso: nada muda e nada é registrado de novo.
    if (atual && JSON.stringify(resumo(atual)) === JSON.stringify(depois)) return;
    await tx.contratoCelcoin.upsert({ where: { id: contratoId }, create: { id: contratoId, ...posicao, ...dono }, update: { ...posicao, ...dono } });
    await auditar(tx, null, "contrato_celcoin_atualizado", "contrato_celcoin", contratoId, { antes: atual ? resumo(atual) : null, depois, vinculo: dono.vinculo });
  });
  return true;
}

/** Contratos ligados ao cliente, para o cartão. O mais recente primeiro. */
export async function contratosCelcoinDoCliente(clienteId: string) {
  const contratos = await db.contratoCelcoin.findMany({ where: { clienteId }, orderBy: { vencimento: "desc" }, take: 10 });
  return contratos.map((c) => ({
    id: c.id, valorCentavos: c.valorCentavos, situacao: c.situacao,
    vencimento: c.vencimento.toISOString().slice(0, 10), pagoEm: c.pagoEm?.toISOString() ?? null, atualizadoEm: c.atualizadoEm.toISOString(),
  }));
}
export type ContratoCelcoinCartao = Awaited<ReturnType<typeof contratosCelcoinDoCliente>>[number];
