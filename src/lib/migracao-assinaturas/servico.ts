import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { dataLocal } from "@/lib/agenda/tempo";
import { auditar } from "@/lib/auditoria";
import { GESTAO, type Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado, proibido } from "@/lib/erros";
import { ehOrigemLegada, META_MIGRACAO, validarTransicaoMigracao } from "./regras";
import { ESTADOS_MIGRACAO, zAcaoMigracao, type AcaoMigracao, type ConsultaMigracao } from "./schemas";

const selecao = {
  id: true, planoId: true, precoCentavos: true, cicloInicio: true, proximoVencimento: true, gatewayId: true, status: true,
  plano: { select: { nome: true } }, migracao: true,
  cliente: { select: {
    id: true, nome: true, aceitaMensagens: true, excluidoEm: true,
    conversa: { select: { estado: true, recusaAutomaticas: true } },
    _count: { select: { assinaturas: { where: { status: { not: "CANCELADA" as const } } } } },
  } },
} as const satisfies Prisma.AssinaturaSelect;
type Contrato = Prisma.AssinaturaGetPayload<{ select: typeof selecao }>;
const base: Prisma.AssinaturaWhereInput = { OR: [
  { gatewayId: { startsWith: "cashbarber:" } }, { gatewayId: { startsWith: "celsub_" } },
  { gatewayId: null }, { migracao: { isNot: null } },
] };
const dia = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;
const objeto = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
function snapshot(a: Contrato) {
  return { planoId: a.planoId, precoCentavos: a.precoCentavos, proximoVencimento: dia(a.proximoVencimento), cicloInicio: a.cicloInicio?.toISOString() ?? null };
}
function apresentar(a: Contrato) {
  const m = a.migracao;
  return {
    assinaturaId: a.id, clienteId: a.cliente.id, cliente: a.cliente.nome, plano: a.plano.nome, status: a.status,
    contrato: snapshot(a), gatewayAtual: a.gatewayId,
    historicoCancelado: a.status === "CANCELADA", origemNaoIdentificada: !ehOrigemLegada(m?.fonteGatewayId ?? a.gatewayId),
    contratosVigentesMesmoCliente: a.cliente._count.assinaturas,
    contatoImpedido: !a.cliente.aceitaMensagens || !!a.cliente.excluidoEm || !!a.cliente.conversa?.recusaAutomaticas || a.cliente.conversa?.estado === "HUMANO",
    migracao: m ? {
      id: m.id, estado: m.estado, versao: m.versao, fonteGatewayId: m.fonteGatewayId, destinoGatewayId: m.destinoGatewayId,
      responsavelId: m.responsavelId, evidencias: objeto(m.evidencias), adiadoAte: dia(m.adiadoAte), atualizadoEm: m.atualizadoEm.toISOString(),
    } : null,
  };
}
export type LinhaMigracao = ReturnType<typeof apresentar>;

/** Inventário local paginado; ler a página nunca inicia migração nem altera cadastros. */
export async function listarQuadroMigracao(filtro: ConsultaMigracao = {}) {
  const condicoes: Prisma.AssinaturaWhereInput[] = [base];
  if (filtro.estado === "A_CONFERIR") condicoes.push({ OR: [{ migracao: { is: null } }, { migracao: { is: { estado: filtro.estado } } }] });
  else if (filtro.estado) condicoes.push({ migracao: { is: { estado: filtro.estado } } });
  if (filtro.responsavelId) condicoes.push({ migracao: { is: { responsavelId: filtro.responsavelId } } });
  const where = { AND: condicoes };
  const [linhas, totalFiltrado, total, cancelados, semControle, estados, responsaveis] = await Promise.all([
    db.assinatura.findMany({ where, select: selecao, orderBy: { id: "asc" }, take: 101, ...(filtro.cursor ? { cursor: { id: filtro.cursor }, skip: 1 } : {}) }),
    db.assinatura.count({ where }), db.assinatura.count({ where: base }),
    db.assinatura.count({ where: { AND: [base, { status: "CANCELADA" }] } }),
    db.assinatura.count({ where: { AND: [base, { migracao: { is: null } }] } }),
    db.migracaoAssinatura.groupBy({ by: ["estado"], _count: { _all: true } }),
    db.usuario.findMany({ where: { papel: { in: GESTAO }, ativo: true }, select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
  ]);
  return {
    meta: META_MIGRACAO, automacaoAtiva: false as const, origem: "INVENTARIO_LOCAL" as const,
    total, totalFiltrado, cancelados, semControle,
    porEstado: Object.fromEntries(ESTADOS_MIGRACAO.map(e => [e, estados.find(x => x.estado === e)?._count._all ?? 0])),
    responsaveis, linhas: linhas.slice(0, 100).map(apresentar), proximoCursor: linhas.length > 100 ? linhas[99].id : null,
  };
}
export type QuadroMigracao = Awaited<ReturnType<typeof listarQuadroMigracao>>;

/** Conferência humana auditável; nunca chama API de pagamento ou de mensagens. */
export async function registrarMigracao(s: Sessao, entrada: AcaoMigracao) {
  if (!GESTAO.includes(s.papel)) throw proibido();
  const p = zAcaoMigracao.parse(entrada);
  const pedidoHash = createHash("sha256").update(JSON.stringify(p)).digest("hex");
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pix-mensal-assinatura:${p.assinaturaId}`}, 0))`;
    await tx.$queryRaw`SELECT id FROM assinaturas WHERE id = ${p.assinaturaId} FOR UPDATE`;
    const a = await tx.assinatura.findUnique({ where: { id: p.assinaturaId }, select: selecao });
    if (!a) throw naoEncontrado("Assinatura");
    if (p.acao === "iniciar") {
      if (a.migracao) return apresentar(a);
      if (!ehOrigemLegada(a.gatewayId) && a.gatewayId !== null) throw new ErroNegocio("Este contrato não identifica uma origem legada para migração.");
      await tx.migracaoAssinatura.create({ data: { assinaturaId: a.id, fonteGatewayId: a.gatewayId, responsavelId: s.usuarioId } });
      await auditar(tx, s.usuarioId, "migracao_iniciar_controle", "assinatura", a.id, { modo: "MANUAL_GERENCIA", fonteGatewayId: a.gatewayId });
    } else {
      const atual = a.migracao;
      if (!atual) throw new ErroNegocio("Inicie a conferência deste contrato primeiro.");
      const provas = objeto(atual.evidencias);
      if (atual.versao === p.versao + 1 && provas.pedidoHash === pedidoHash && provas.confirmadoPorId === s.usuarioId) return apresentar(a);
      if (atual.versao !== p.versao) throw new ErroNegocio("A conferência mudou. Atualize o quadro antes de continuar.", 409, "migracao_alterada");
      if (JSON.stringify(snapshot(a)) !== JSON.stringify(p.contrato)) throw new ErroNegocio("O contrato ou o ciclo mudou. Confira novamente os valores e datas.", 409, "contrato_alterado");
      const fonte = atual.fonteGatewayId ?? (ehOrigemLegada(a.gatewayId) ? a.gatewayId : null);
      if (!["A_CONFERIR", "AJUDA", "ADIADO", "NAO_CONTATAR"].includes(p.estado) && !fonte) throw new ErroNegocio("Concilie a origem legada antes de avançar.");
      if (p.estado === "CONCLUIDO" && (!a.cicloInicio || !p.conferencia.contratoConciliado)) throw new ErroNegocio("O período pago precisa estar conciliado antes da conclusão.");
      if (["PRONTO", "CONVIDADO", "INICIOU", "CARTAO_CONFIRMADO", "LEGADO_CONCILIADO", "CONCLUIDO"].includes(p.estado) && a.cliente._count.assinaturas > 1) throw new ErroNegocio("Há mais de um contrato vigente no cadastro: resolva o vínculo ambíguo antes de avançar.");
      validarTransicaoMigracao({
        de: atual.estado, para: p.estado, statusAssinatura: a.status, gatewayAtual: a.gatewayId,
        destinoGatewayId: p.destinoGatewayId, proximoVencimento: dia(a.proximoVencimento), adiadoAte: p.adiadoAte,
        hoje: dataLocal(Date.now(), "America/Sao_Paulo"), contatoImpedido: apresentar(a).contatoImpedido, conferencia: p.conferencia,
      });
      const evidencias = {
        modo: "MANUAL_GERENCIA", ...p.conferencia, contrato: snapshot(a), confirmadoPorId: s.usuarioId,
        confirmadoEm: new Date().toISOString(), pedidoHash,
      };
      const mudou = await tx.migracaoAssinatura.updateMany({ where: { id: atual.id, versao: p.versao, estado: atual.estado }, data: {
        estado: p.estado, versao: { increment: 1 }, fonteGatewayId: fonte, destinoGatewayId: p.destinoGatewayId,
        adiadoAte: p.adiadoAte ? new Date(`${p.adiadoAte}T00:00:00Z`) : null, responsavelId: s.usuarioId, evidencias,
      } });
      if (!mudou.count) throw new ErroNegocio("A conferência mudou. Atualize antes de continuar.", 409, "migracao_alterada");
      await auditar(tx, s.usuarioId, "migracao_conferencia", "assinatura", a.id, { antes: atual.estado, depois: p.estado, ...evidencias, fonteGatewayId: fonte, destinoGatewayId: p.destinoGatewayId });
    }
    return apresentar(await tx.assinatura.findUniqueOrThrow({ where: { id: a.id }, select: selecao }));
  });
}
