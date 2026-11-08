import { randomUUID } from "node:crypto";
import type { StatusAssinatura } from "@prisma/client";
import { auditar } from "@/lib/auditoria";
import { db } from "@/lib/db";
import { ErroNegocio } from "@/lib/erros";
import { gatewayPorId, type CobrancaGateway } from "@/lib/pagamentos/gateway";
import { quarentenaRestauracao } from "@/lib/recuperacao/quarentena";

const LEASE_MS = 2 * 60_000;
const LIMITE_TENTATIVAS = 5;
type Transicao = { de: StatusAssinatura; para: StatusAssinatura };
type Sincronizar = (cobranca: CobrancaGateway) => Promise<Transicao | null>;
type Resultado = { repetido: boolean; legado?: boolean; transicao?: Transicao };

/** Só este fluxo consulta o gateway e reconcilia dados locais; não cria cobranças nem transfere valores. */
export class FalhaSincronizacaoAssinatura extends Error {
  constructor(readonly podeRetentar: boolean) {
    super(podeRetentar ? "A reconciliação da assinatura aguarda nova consulta segura." : "A reconciliação da assinatura exige conferência.");
    this.name = "FalhaSincronizacaoAssinatura";
  }
}

async function reservar(eventoId: string, tipo: string, cobrancaId: string, agora: Date) {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`evento-pagamento:${eventoId}`}, 0))`;
    const e = await tx.eventoPagamento.findUnique({ where: { id: eventoId } });
    if (e && (e.tipo !== tipo || e.cobrancaId !== cobrancaId)) throw new ErroNegocio("Identificador de evento reutilizado com outros dados.", 409, "evento_divergente");
    if (e?.estado === "LEGADO" || e?.estado === "CONCLUIDO") return { repetido: true as const, legado: e.estado === "LEGADO" };
    if (e && e.tentativas >= LIMITE_TENTATIVAS) throw new FalhaSincronizacaoAssinatura(false);
    if (e?.estado === "PROCESSANDO" && e.atualizadoEm && +e.atualizadoEm > +agora - LEASE_MS) throw new FalhaSincronizacaoAssinatura(true);
    const tentativaToken = randomUUID(), tentativas = (e?.tentativas ?? 0) + 1;
    const dados = { estado: "PROCESSANDO", tentativaToken, tentativas, atualizadoEm: agora };
    if (e) await tx.eventoPagamento.update({ where: { id: eventoId }, data: dados });
    else await tx.eventoPagamento.create({ data: { id: eventoId, tipo, cobrancaId, ...dados } });
    await auditar(tx, null, "assinatura_evento_tentativa", "evento_pagamento", eventoId, { cobrancaId, tentativa: tentativas, retomada: !!e });
    return { repetido: false as const, tentativaToken, tentativas, retomada: !!e };
  });
}

async function finalizar(eventoId: string, tentativaToken: string, estado: "FALHOU" | "CONCLUIDO", agora: Date) {
  return db.$transaction(async tx => {
    const r = await tx.eventoPagamento.updateMany({ where: { id: eventoId, estado: "PROCESSANDO", tentativaToken },
      data: { estado, atualizadoEm: agora, ...(estado === "CONCLUIDO" ? { concluidoEm: agora } : {}) } });
    if (r.count) await auditar(tx, null, estado === "CONCLUIDO" ? "assinatura_evento_concluido" : "assinatura_evento_falhou", "evento_pagamento", eventoId);
    return r.count > 0;
  });
}

export async function processarEventoAssinatura(eventoId: string, tipo: string, cobrancaGatewayId: string, sincronizar: Sincronizar): Promise<Resultado> {
  if (quarentenaRestauracao()) throw new FalhaSincronizacaoAssinatura(false);
  let claim: Awaited<ReturnType<typeof reservar>>;
  try { claim = await reservar(eventoId, tipo, cobrancaGatewayId, new Date()); }
  catch (erro) {
    if (erro instanceof FalhaSincronizacaoAssinatura || erro instanceof ErroNegocio) throw erro;
    // Mesmo se o commit do claim ficou incerto, nenhum efeito foi iniciado e o token será conferido.
    throw new FalhaSincronizacaoAssinatura(true);
  }
  if (claim.repetido) return claim;
  let retentavel = true;
  try {
    const gateway = await gatewayPorId(cobrancaGatewayId);
    const cob = await gateway.buscarCobranca(cobrancaGatewayId);
    // Nunca usa o conteúdo de um webhook nem um resultado atribuído a outra cobrança como prova.
    if (cob.id !== cobrancaGatewayId) { retentavel = false; throw new Error("Cobrança divergente."); }
    const local = await db.cobranca.findUnique({ where: { gatewayId: cob.id }, select: { assinatura: { select: { id: true, gatewayId: true, status: true, clienteId: true } } } });
    const assinatura = local?.assinatura ?? (cob.assinaturaGatewayId
      ? await db.assinatura.findUnique({ where: { gatewayId: cob.assinaturaGatewayId }, select: { id: true, gatewayId: true, status: true, clienteId: true } }) : null);
    if (!assinatura) { retentavel = false; throw new Error("Assinatura não vinculada."); }
    if (cob.assinaturaGatewayId && assinatura.gatewayId !== cob.assinaturaGatewayId) { retentavel = false; throw new Error("Assinatura divergente."); }
    const transicao = await sincronizar(cob);
    if (!transicao) { retentavel = false; throw new Error("Transição não comprovada."); }
    // Uma queda após o commit pode ter interrompido só a conversão local da agenda. Ela é idempotente.
    // Não repete o aviso de ativação nem qualquer ação no meio de pagamento.
    if (claim.retomada && assinatura.status === "ATIVA" && cob.status === "PAGA" && transicao.para === "ATIVA") {
      const [{ aplicarPlanoAosFuturos }, { configuracao }] = await Promise.all([import("./agenda"), import("@/lib/agenda/carregar")]);
      await aplicarPlanoAosFuturos(assinatura.clienteId, (await configuracao()).fuso);
    }
    if (!await finalizar(eventoId, claim.tentativaToken, "CONCLUIDO", new Date())) throw new FalhaSincronizacaoAssinatura(true);
    return { repetido: false, transicao };
  } catch (erro) {
    // Uma indisponibilidade deixa o claim durável para expirar; não o apaga nem declara conclusão.
    try { await finalizar(eventoId, claim.tentativaToken, "FALHOU", new Date()); } catch { /* A próxima consulta respeita o lease. */ }
    throw new FalhaSincronizacaoAssinatura(retentavel && claim.tentativas < LIMITE_TENTATIVAS
      && (!(erro instanceof FalhaSincronizacaoAssinatura) || erro.podeRetentar));
  }
}
