import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { quarentenaRestauracao } from "@/lib/recuperacao/quarentena";
import { FalhaSincronizacaoAssinatura } from "@/lib/assinaturas/eventos";
import { auditar } from "@/lib/auditoria";

const identificador = z.string().min(1).max(300);
const cargaSchema = z.discriminatedUnion("fonte", [
  z.object({ fonte: z.literal("asaas"), evento: identificador, tipo: identificador, cobranca: identificador }),
  z.object({ fonte: z.literal("celcash"), evento: identificador, tipo: identificador, cobranca: identificador }),
  z.object({ fonte: z.literal("pagarme"), evento: identificador, tipo: identificador, cobrancas: z.array(identificador).max(100), pedido: identificador.nullable(), assinaturaCancelada: identificador.nullable() }),
]);
export type EntradaWebhook = z.infer<typeof cargaSchema>;

function canonico(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonico).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, valor]) => `${JSON.stringify(k)}:${canonico(valor)}`).join(",")}}`;
  return JSON.stringify(v);
}

/** Persiste apenas identificadores mínimos antes de responder ao provedor. */
export async function registrarWebhookPagamento(entrada: EntradaWebhook) {
  if (quarentenaRestauracao()) throw new Error("Webhooks pausados durante recuperação.");
  const carga = cargaSchema.parse(entrada);
  const id = createHash("sha256").update(`${carga.fonte}:${carga.evento}`).digest("hex");
  const chaveSequencia = carga.fonte === "pagarme"
    ? `${carga.fonte}:${carga.pedido ?? carga.cobrancas[0] ?? carga.assinaturaCancelada ?? carga.evento}`
    : `${carga.fonte}:${carga.cobranca}`;
  try {
    await db.webhookPagamentoEntrada.create({ data: { id, fonte: carga.fonte, chaveSequencia, carga } });
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") throw e;
    const existente = await db.webhookPagamentoEntrada.findUniqueOrThrow({ where: { id } });
    if (canonico(existente.carga) !== canonico(carga)) throw new Error("Webhook repetido com dados diferentes; requer revisão.");
  }
  return id;
}

async function executar(carga: EntradaWebhook) {
  if (carga.fonte === "pagarme") {
    const { processarWebhookPagarme } = await import("./webhook-pagarme");
    await processarWebhookPagarme(carga);
    return;
  }
  const { processarEventoGateway } = await import("@/lib/assinaturas/cobrancas");
  const r = await processarEventoGateway(carga.evento, carga.tipo, carga.cobranca);
  // Uma cobrança sem vínculo local não deve ser anunciada como conciliada.
  if (!r.repetido && !r.transicao) throw new Error("Cobrança sem transição comprovada.");
}

/** Claim único; qualquer falha é retida para revisão, sem executar novamente às cegas. */
export async function processarWebhookEntrada(id: string, executarEvento: (carga: EntradaWebhook) => Promise<void> = executar) {
  if (quarentenaRestauracao()) return false;
  const claim = await db.$transaction(async (tx) => {
    const item = await tx.webhookPagamentoEntrada.findUnique({ where: { id }, select: { chaveSequencia: true, estado: true } });
    if (!item || item.estado !== "PENDENTE") return false;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`webhook-pagamento:${item.chaveSequencia}`}, 0))`;
    const bloqueada = await tx.webhookPagamentoEntrada.findFirst({ where: { chaveSequencia: item.chaveSequencia, id: { not: id }, estado: { in: ["PROCESSANDO", "REVISAO"] } }, select: { id: true } });
    if (bloqueada) return false;
    const primeira = await tx.webhookPagamentoEntrada.findFirst({ where: { chaveSequencia: item.chaveSequencia, estado: "PENDENTE" }, orderBy: { sequencia: "asc" }, select: { id: true } });
    if (primeira?.id !== id) return false;
    return (await tx.webhookPagamentoEntrada.updateMany({ where: { id, estado: "PENDENTE" }, data: { estado: "PROCESSANDO" } })).count > 0;
  });
  if (!claim) return false;
  let apenasAssinatura = false;
  try {
    const item = await db.webhookPagamentoEntrada.findUniqueOrThrow({ where: { id } });
    const carga = cargaSchema.parse(item.carga);
    apenasAssinatura = carga.fonte !== "pagarme" || (!carga.pedido && !carga.assinaturaCancelada);
    await executarEvento(carga);
    await db.webhookPagamentoEntrada.updateMany({ where: { id, estado: "PROCESSANDO" }, data: { estado: "CONCLUIDO" } });
  } catch (erro) {
    // A exceção tipada só vem de consulta canônica + reconciliação local de assinatura. Pedidos,
    // cancelamentos externos e falhas ambíguas de outros fluxos continuam exigindo revisão.
    const estado = apenasAssinatura && erro instanceof FalhaSincronizacaoAssinatura && erro.podeRetentar ? "PENDENTE" : "REVISAO";
    await db.$transaction(async tx => {
      const r = await tx.webhookPagamentoEntrada.updateMany({ where: { id, estado: "PROCESSANDO" }, data: { estado } });
      if (r.count) await auditar(tx, null, estado === "PENDENTE" ? "webhook_assinatura_retentar" : "webhook_pagamento_revisar", "webhook_pagamento_entrada", id);
    });
  }
  return true;
}

/** Processo interrompido pode ter efetuado ações externas: marcar revisão, nunca repetir cegamente. */
export async function recuperarWebhooksPagamento(agora = new Date(), executarEvento?: (carga: EntradaWebhook) => Promise<void>) {
  if (quarentenaRestauracao()) return 0;
  await db.webhookPagamentoEntrada.updateMany({ where: { estado: "PROCESSANDO", atualizadoEm: { lt: new Date(+agora - 10 * 60_000) } }, data: { estado: "REVISAO" } });
  // Entradas presas atrás de uma revisão não devem impedir outras transações.
  const pendentes = await db.$queryRaw<{ id: string }[]>`
    SELECT p.id FROM webhooks_pagamento_entrada p
    WHERE p.estado = 'PENDENTE' AND NOT EXISTS (
      SELECT 1 FROM webhooks_pagamento_entrada b
      WHERE b."chaveSequencia" = p."chaveSequencia" AND b.estado IN ('PROCESSANDO', 'REVISAO')
    ) ORDER BY p.sequencia LIMIT 25`;
  for (const p of pendentes) await processarWebhookEntrada(p.id, executarEvento);
  return pendentes.length;
}
