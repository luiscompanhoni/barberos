/**
 * Preparação e despacho com adaptador injetado, chamados pela rotina somente sob flag desligada por padrão.
 * A flag é desligada por padrão. Não reenviar falha, timeout ou processo interrompido.
 */
import { db } from "@/lib/db";
import { dataLocal } from "@/lib/agenda/tempo";
import { avaliarCobrancaAutomatica, linkPermitido } from "./cobranca-automatica-regras";
import type { CobrancaGateway } from "@/lib/pagamentos/gateway";

type Transporte = (d: { telefone: string; nome: string; plano: string; link: string; valorCentavos: number; vencimento: string }) => Promise<{ idProvedor: string | null }>;
type ConsultarGateway = (id: string) => Promise<CobrancaGateway>;
export const dominiosPermitidos = () => (process.env.COBRANCA_AUTOMATICA_LINK_HOSTS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const fusoDaBarbearia = async () => (await db.configuracao.findUnique({ where: { id: 1 }, select: { fuso: true } }))?.fuso ?? "America/Sao_Paulo";

export type SnapshotCobranca = { cobrancaId: string; gatewayId: string; assinaturaGatewayId: string | null; status: string; forma: string | null; link: string | null; tokenPublico: string | null; valorCentavos: number; vencimento: string; expiraEm: number | null; clienteId: string; telefone: string };

/** Exige vínculo, forma e link comprovados pelo gateway; sem evidência fica em revisão. */
export function gatewayConfere(c: SnapshotCobranca, remota: CobrancaGateway, agora: Date) {
  const pixExpira = remota.expiraEm ? Date.parse(remota.expiraEm) : NaN;
  return !!c.assinaturaGatewayId && !!remota.assinaturaGatewayId && c.assinaturaGatewayId === remota.assinaturaGatewayId
    && !!c.forma && remota.forma === c.forma && remota.id === c.gatewayId && remota.abertaConfirmada === true && ["PENDENTE", "ATRASADA"].includes(remota.status) && !remota.pagaEm
    && remota.valorCentavos === c.valorCentavos && remota.vencimentoConfirmado === true && remota.vencimento === c.vencimento
    && linkPermitido(c.link, c.tokenPublico, dominiosPermitidos()) && (!!c.link && (c.link.startsWith("/") || remota.link === c.link))
    && (c.forma !== "PIX" || (Number.isFinite(c.expiraEm) && c.expiraEm! > +agora + 3_600_000 && Number.isFinite(pixExpira) && pixExpira > +agora + 3_600_000));
}

async function carregar(tx: Parameters<Parameters<typeof db.$transaction>[0]>[0], cobrancaId: string) {
  await tx.$queryRaw`SELECT id FROM cobrancas WHERE id = ${cobrancaId} FOR UPDATE`;
  return tx.cobranca.findUnique({ where: { id: cobrancaId }, include: {
    vinculosExternos: { select: { id: true }, take: 1 },
    assinatura: { include: { cliente: { select: { telefone: true, nome: true, aceitaMensagens: true, excluidoEm: true } }, plano: { select: { nome: true } } } },
  } });
}

type CobrancaCarregada = NonNullable<Awaited<ReturnType<typeof carregar>>>;
function snapshot(c: CobrancaCarregada): SnapshotCobranca {
  return { cobrancaId: c.id, gatewayId: c.gatewayId, assinaturaGatewayId: c.assinatura.gatewayId, status: c.status, forma: c.forma,
    link: c.link, tokenPublico: c.tokenPublico, valorCentavos: c.valorCentavos, vencimento: c.vencimento.toISOString().slice(0, 10),
    expiraEm: c.expiraEm ? +c.expiraEm : null, clienteId: c.assinatura.clienteId, telefone: c.assinatura.cliente.telefone };
}

/** Revalida o registro local depois da consulta remota, sem reativar tentativas. */
export async function confirmarAntesDoEnvio(id: string, anterior: SnapshotCobranca, agora = new Date()) {
  const fuso = await fusoDaBarbearia();
  return db.$transaction(async (tx) => {
    const tentativa = await tx.tentativaCobrancaAutomatica.findUnique({ where: { id } });
    if (!tentativa || tentativa.estado !== "ENVIANDO" || tentativa.cobrancaId !== anterior.cobrancaId) return false;
    const c = await carregar(tx, tentativa.cobrancaId);
    if (!c) return false;
    const duplicatas = await tx.cobranca.count({ where: { assinaturaId: c.assinaturaId, vencimento: c.vencimento, valorCentavos: c.valorCentavos, status: { not: "CANCELADA" } } });
    const s = snapshot(c);
    const valido = JSON.stringify(s) === JSON.stringify(anterior) && ["PENDENTE", "ATRASADA"].includes(c.status) && !c.pagaEm
      && c.assinatura.status !== "CANCELADA" && !c.assinatura.pausadaEm && !c.assinatura.encerraEm && c.assinatura.cliente.aceitaMensagens && !c.assinatura.cliente.excluidoEm && !c.vinculosExternos.length && duplicatas <= 1
      && linkPermitido(c.link, c.tokenPublico, dominiosPermitidos()) && (c.forma !== "PIX" || (!!c.expiraEm && +c.expiraEm > +agora + 3_600_000))
      && (c.forma !== "BOLETO" || s.vencimento >= dataLocal(+agora, fuso));
    if (!valido) await tx.tentativaCobrancaAutomatica.updateMany({ where: { id, estado: "ENVIANDO" }, data: { estado: "REVISAO", revisaoMotivo: "dados_alterados", versao: { increment: 1 } } });
    return valido;
  });
}

/** Idempotência por fatura, canal e etapa; mantém inclusive tentativas inconclusivas. */
export async function prepararCobrancaAutomatica(cobrancaId: string, agora = new Date()) {
  if (process.env.COBRANCA_AUTOMATICA_WHATSAPP_ATIVA !== "true") return { ativo: false as const };
  const fuso = await fusoDaBarbearia();
  return db.$transaction(async (tx) => {
    const c = await carregar(tx, cobrancaId);
    if (!c) return { ativo: true as const, encontrada: false as const };
    const existente = await tx.tentativaCobrancaAutomatica.findUnique({ where: { cobrancaId_canal_etapa: { cobrancaId, canal: "WHATSAPP", etapa: "PRIMEIRO_AVISO" } } });
    if (existente) return { ativo: true as const, encontrada: true as const, tentativa: existente, repetida: true };
    const r = avaliarCobrancaAutomatica({ ...c, assinaturaStatus: c.assinatura.status, pausadaEm: c.assinatura.pausadaEm, encerraEm: c.assinatura.encerraEm, aceitaMensagens: c.assinatura.cliente.aceitaMensagens,
      excluido: !!c.assinatura.cliente.excluidoEm, historicaVinculada: c.vinculosExternos.length > 0 }, dataLocal(+agora, fuso), agora, dominiosPermitidos());
    if (r.estado === "CANCELADA") return { ativo: true as const, encontrada: true as const, semRegistro: true as const, motivo: r.motivo };
    const tentativa = await tx.tentativaCobrancaAutomatica.create({ data: { cobrancaId, estado: r.estado, revisaoMotivo: r.motivo } });
    return { ativo: true as const, encontrada: true as const, tentativa, repetida: false };
  });
}

/** Uma única tentativa; a falha do provedor ou ausência de identificador ficam incertas. */
export async function despacharCobrancaAutomatica(id: string, enviar: Transporte, consultar: ConsultarGateway, agora = new Date(), relogio: () => Date = () => new Date()) {
  if (process.env.COBRANCA_AUTOMATICA_WHATSAPP_ATIVA !== "true") return { estado: "DESATIVADA" as const };
  const fuso = await fusoDaBarbearia();
  const preparada = await db.$transaction(async (tx) => {
    const t = await tx.tentativaCobrancaAutomatica.findUnique({ where: { id } });
    if (!t || t.estado !== "PREPARADA") return null;
    const c = await carregar(tx, t.cobrancaId);
    if (!c) return null;
    const duplicatas = await tx.cobranca.count({ where: { assinaturaId: c.assinaturaId, vencimento: c.vencimento, valorCentavos: c.valorCentavos, status: { not: "CANCELADA" } } });
    const r = avaliarCobrancaAutomatica({ ...c, assinaturaStatus: c.assinatura.status, pausadaEm: c.assinatura.pausadaEm, encerraEm: c.assinatura.encerraEm, aceitaMensagens: c.assinatura.cliente.aceitaMensagens,
      excluido: !!c.assinatura.cliente.excluidoEm, historicaVinculada: c.vinculosExternos.length > 0 }, dataLocal(+agora, fuso), agora, dominiosPermitidos());
    const estado = duplicatas > 1 ? "REVISAO" : r.estado;
    const claim = await tx.tentativaCobrancaAutomatica.updateMany({ where: { id, estado: "PREPARADA", versao: t.versao }, data: { estado: estado === "PREPARADA" ? "ENVIANDO" : estado, revisaoMotivo: duplicatas > 1 ? "possivel_duplicidade" : r.motivo, versao: { increment: 1 } } });
    if (claim.count !== 1 || estado !== "PREPARADA" || !c.link) return null;
    return { telefone: c.assinatura.cliente.telefone, nome: c.assinatura.cliente.nome, plano: c.assinatura.plano.nome,
      link: c.link, snapshot: snapshot(c),
      valorCentavos: c.valorCentavos, vencimento: c.vencimento.toISOString().slice(0, 10) };
  });
  if (!preparada) return { estado: "NAO_DESPACHADA" as const };
  // Consulta sem mutação ao provedor; divergências nunca geram link novo ou tentativa de envio.
  let remota: CobrancaGateway;
  try { remota = await consultar(preparada.snapshot.gatewayId); } catch {
    await db.tentativaCobrancaAutomatica.updateMany({ where: { id, estado: "ENVIANDO" }, data: { estado: "REVISAO", revisaoMotivo: "gateway_indisponivel", versao: { increment: 1 } } });
    return { estado: "REVISAO" as const };
  }
  if (!gatewayConfere(preparada.snapshot, remota, relogio())) {
    await db.tentativaCobrancaAutomatica.updateMany({ where: { id, estado: "ENVIANDO" }, data: { estado: "REVISAO", revisaoMotivo: "gateway_divergente", versao: { increment: 1 } } });
    return { estado: "REVISAO" as const };
  }
  if (!(await confirmarAntesDoEnvio(id, preparada.snapshot, relogio()))) return { estado: "VERIFICAR" as const };
  // O gateway e o banco podem demorar; validade precisa ser conferida no instante do despacho.
  if (!gatewayConfere(preparada.snapshot, remota, relogio())) {
    await db.tentativaCobrancaAutomatica.updateMany({ where: { id, estado: "ENVIANDO" }, data: { estado: "REVISAO", revisaoMotivo: "validade_alterada", versao: { increment: 1 } } });
    return { estado: "REVISAO" as const };
  }
  let idProvedor: string | null = null;
  try { idProvedor = (await enviar(preparada)).idProvedor; } catch { /* Qualquer erro pode ter ocorrido após aceitação. */ }
  const estado = idProvedor ? "ACEITA" : "INCERTA";
  const atualizado = await db.tentativaCobrancaAutomatica.updateMany({ where: { id, estado: "ENVIANDO" }, data: { estado, mensagemId: idProvedor, versao: { increment: 1 } } });
  return { estado: atualizado.count === 1 ? estado : "VERIFICAR" as const };
}

/** Queda do processo pode ocorrer após aceitação: apenas marca incerta, nunca reenvia. */
export async function marcarEnviosInterrompidosIncertos(antesDe: Date) {
  return db.tentativaCobrancaAutomatica.updateMany({ where: { estado: "ENVIANDO", atualizadoEm: { lt: antesDe } },
    data: { estado: "INCERTA", revisaoMotivo: "processo_interrompido", versao: { increment: 1 } } });
}

/** Reserva compartilhada pelo atalho humano e pela rotina; não realiza envio. */
export async function reservarCobrancaManual(cobrancaId: string) {
  return db.$transaction(async (tx) => {
    const c = await carregar(tx, cobrancaId);
    if (!c || !["PENDENTE", "ATRASADA"].includes(c.status) || c.pagaEm || c.assinatura.status === "CANCELADA" || c.assinatura.pausadaEm || c.assinatura.encerraEm || !c.assinatura.cliente.aceitaMensagens || c.assinatura.cliente.excluidoEm || !linkPermitido(c.link, c.tokenPublico, dominiosPermitidos())) return null;
    const duplicatas = await tx.cobranca.count({ where: { assinaturaId: c.assinaturaId, vencimento: c.vencimento, valorCentavos: c.valorCentavos, status: { not: "CANCELADA" } } });
    if (duplicatas > 1 || c.vinculosExternos.length) return null;
    const atual = await tx.tentativaCobrancaAutomatica.findUnique({ where: { cobrancaId_canal_etapa: { cobrancaId, canal: "WHATSAPP", etapa: "PRIMEIRO_AVISO" } } });
    if (atual && atual.estado !== "PREPARADA") return null;
    if (atual) {
      const alterada = await tx.tentativaCobrancaAutomatica.updateMany({ where: { id: atual.id, estado: "PREPARADA", versao: atual.versao }, data: { estado: "ENVIANDO", versao: { increment: 1 } } });
      return alterada.count ? { id: atual.id, snapshot: snapshot(c) } : null;
    }
    const criada = await tx.tentativaCobrancaAutomatica.create({ data: { cobrancaId, estado: "ENVIANDO" } });
    return { id: criada.id, snapshot: snapshot(c) };
  });
}

/** Apenas aceitação com ID do provedor é aceita; qualquer outro resultado é incerto. */
export async function concluirCobrancaManual(id: string, idProvedor: string | null) {
  const estado = idProvedor ? "ACEITA" : "INCERTA";
  const r = await db.tentativaCobrancaAutomatica.updateMany({ where: { id, estado: "ENVIANDO" }, data: { estado, mensagemId: idProvedor, versao: { increment: 1 } } });
  return r.count === 1 ? estado : "INCERTA";
}

/** Consulta do gateway falhou antes do envio: exige revisão, sem reenvio automático. */
export async function revisarCobrancaManual(id: string) {
  await db.tentativaCobrancaAutomatica.updateMany({ where: { id, estado: "ENVIANDO" }, data: { estado: "REVISAO", revisaoMotivo: "gateway_nao_confirmou", versao: { increment: 1 } } });
}
