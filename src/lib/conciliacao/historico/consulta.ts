import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { naoEncontrado } from "@/lib/erros";
import { buscarTransacaoHistorica } from "./fonte";
import { backupApto, cpfsParaBusca, digitos, gatewaysDaTransacao, planejarHistorico, telefoneNormal } from "./regras";
import { zEscolhaHistorico, type EscolhaHistorico, type TransacaoHistorica } from "./schemas";

const cobrancaSelect = {
  id: true, assinaturaId: true, gatewayId: true, valorCentavos: true, vencimento: true, status: true,
  pagaEm: true, atualizadaEm: true,
} as const;
const clienteSelect = { id: true, nome: true, telefone: true, cpf: true } as const;

export async function contextoHistorico(tx: Prisma.TransactionClient, fonte: TransacaoHistorica, assinaturaId: string) {
  const assinatura = await tx.assinatura.findUnique({ where: { id: assinaturaId }, select: {
    id: true, clienteId: true, status: true, gatewayId: true, cliente: { select: clienteSelect },
  } });
  if (!assinatura) throw naoEncontrado("Assinatura");
  const [movimentos, cobrancas, canonicas, vinculos, backup, clientesMesmoCpf] = await Promise.all([
    tx.movimentoExterno.findMany({ where: { fonte: "CELCASH", transacaoId: fonte.id, tipo: { in: ["RECEBIMENTO", "ESTORNO"] } }, orderBy: { id: "asc" }, select: {
      id: true, fonte: true, tipo: true, transacaoId: true, valorCentavos: true, data: true,
    } }),
    tx.cobranca.findMany({ where: { assinatura: { clienteId: assinatura.clienteId } }, orderBy: { id: "asc" }, select: cobrancaSelect }),
    tx.cobranca.findMany({ where: { gatewayId: { in: gatewaysDaTransacao(fonte.id) } }, orderBy: { id: "asc" }, select: cobrancaSelect }),
    tx.vinculoCobrancaExterna.findMany({ where: { fonte: "CELCASH", OR: [{ transacaoId: fonte.id }, { cobranca: { assinatura: { clienteId: assinatura.clienteId } } }] }, orderBy: { id: "asc" } }),
    tx.backupRegistro.findFirst({ orderBy: { criadoEm: "desc" } }),
    tx.cliente.findMany({ where: { cpf: { in: [...cpfsParaBusca(fonte.cliente.cpf), ...cpfsParaBusca(assinatura.cliente.cpf)] } }, select: { id: true }, orderBy: { id: "asc" } }),
  ]);
  const pedidos = await tx.pedidoEstorno.findMany({ where: { tipo: "MENSALIDADE", referenciaId: { in: cobrancas.map((x) => x.id) } }, orderBy: { id: "asc" }, select: {
    id: true, referenciaId: true, status: true, valorCentavos: true, executadoEm: true,
  } });
  return { fonte, assinatura, movimentos, cobrancas, canonicas, vinculos, pedidos, backup, clientesMesmoCpf };
}
export type ContextoCompleto = Awaited<ReturnType<typeof contextoHistorico>>;

export function chaveEscolhaHistorico(p: EscolhaHistorico, backupId: string) {
  return createHash("sha256").update(JSON.stringify({ escolha: zEscolhaHistorico.parse(p), backupId })).digest("hex");
}

export function revisaoHistorico(p: EscolhaHistorico, c: ContextoCompleto) {
  return createHash("sha256").update(JSON.stringify({ escolha: zEscolhaHistorico.parse(p), contexto: c }, (_, v) => typeof v === "bigint" ? String(v) : v)).digest("hex");
}

export function apresentarPrevia(p: EscolhaHistorico, c: ContextoCompleto) {
  const plano = planejarHistorico(p, c);
  const bom = backupApto(c.backup);
  const antes = plano.cobranca ? {
    id: plano.cobranca.id, assinaturaId: plano.cobranca.assinaturaId, valorCentavos: plano.cobranca.valorCentavos,
    vencimento: plano.cobranca.vencimento.toISOString().slice(0, 10), pagaEm: plano.cobranca.pagaEm?.toISOString() ?? null, status: plano.cobranca.status,
  } : null;
  return {
    revisao: revisaoHistorico(p, c), bloqueios: plano.bloqueios, avisos: plano.avisos,
    cliente: { id: c.assinatura.clienteId, nome: c.assinatura.cliente.nome }, antes,
    depois: {
      assinaturaId: p.assinaturaId, valorCentavos: antes?.valorCentavos ?? c.fonte.valorCentavos,
      vencimento: antes?.vencimento ?? c.fonte.vencimento,
      pagaEm: antes ? antes.pagaEm : plano.recebimento?.data.toISOString() ?? null,
      status: plano.registrarEstorno ? "ESTORNADA" : antes?.status ?? "PAGA",
      estornoEm: plano.registrarEstorno ? plano.estorno?.data.toISOString() ?? null : null,
      transacaoId: c.fonte.id, contratoId: c.fonte.contratoId,
    },
    backup: c.backup ? { id: c.backup.id, criadoEm: c.backup.criadoEm.toISOString(), conferencia: c.backup.conferencia, apto: bom } : null,
    podeAplicar: !plano.bloqueios.length && bom,
  };
}
export type PreviaHistorico = ReturnType<typeof apresentarPrevia>;

export async function preverHistorico(p: EscolhaHistorico) {
  const fonte = await buscarTransacaoHistorica(p.transacaoId);
  return apresentarPrevia(p, await contextoHistorico(db, fonte, p.assinaturaId));
}

/** Consulta somente leitura, sem executar o importador legado. */
export async function consultarHistorico(id: string, clienteId?: string) {
  const fonte = await buscarTransacaoHistorica(id);
  const telefones = fonte.cliente.telefones.map(telefoneNormal).filter(Boolean);
  const cpf = digitos(fonte.cliente.cpf);
  const candidatos = await db.cliente.findMany({ where: { OR: [
    ...(telefones.length ? [{ telefone: { in: telefones } }] : []),
    ...(cpfsParaBusca(cpf).length ? [{ cpf: { in: cpfsParaBusca(fonte.cliente.cpf) } }] : []),
    ...(clienteId ? [{ id: clienteId }] : []),
  ] }, select: clienteSelect, take: 20, orderBy: { id: "asc" } });
  const [assinaturas, movimentos, vinculo] = await Promise.all([
    db.assinatura.findMany({ where: { clienteId: { in: candidatos.map((x) => x.id) } }, orderBy: { criadaEm: "desc" }, select: {
      id: true, clienteId: true, status: true, plano: { select: { nome: true } }, gatewayId: true,
      cobrancas: { orderBy: { vencimento: "desc" }, select: cobrancaSelect },
    } }),
    db.movimentoExterno.findMany({ where: { fonte: "CELCASH", transacaoId: id, tipo: { in: ["RECEBIMENTO", "ESTORNO"] } }, orderBy: { data: "asc" }, select: { id: true, tipo: true, data: true, valorCentavos: true } }),
    db.vinculoCobrancaExterna.findUnique({ where: { fonte_transacaoId: { fonte: "CELCASH", transacaoId: id } }, select: { cobrancaId: true, pedidoEstornoId: true, evidencia: true } }),
  ]);
  return {
    fonte: { ...fonte, cliente: { ...fonte.cliente, cpf: cpf.length === 11 ? `***.***.***-${cpf.slice(-2)}` : "Não informado" } },
    candidatos: candidatos.map(({ cpf: documento, ...c }) => ({ ...c, cpf: digitos(documento).length === 11 ? `***.***.***-${digitos(documento).slice(-2)}` : "Não informado" })),
    assinaturas: assinaturas.map((a) => ({ ...a, plano: a.plano.nome, cobrancas: a.cobrancas.map((x) => ({ ...x, vencimento: x.vencimento.toISOString().slice(0, 10), pagaEm: x.pagaEm?.toISOString() ?? null, atualizadaEm: x.atualizadaEm.toISOString() })) })),
    movimentos: movimentos.map((m) => ({ ...m, data: m.data.toISOString() })),
    vinculo: vinculo ? { cobrancaId: vinculo.cobrancaId, pedidoEstornoId: vinculo.pedidoEstornoId,
      divergente: (vinculo.evidencia as { divergenciaGateway?: { pendente?: boolean } }).divergenciaGateway?.pendente === true } : null,
  };
}
export type ConsultaHistorico = Awaited<ReturnType<typeof consultarHistorico>>;
