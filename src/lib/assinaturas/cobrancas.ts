/**
 * Cobrancas das assinaturas: sincroniza com o gateway e atualiza o status da
 * assinatura. Toda mudanca vem do gateway (webhook ou sincronizacao manual),
 * nunca do payload recebido.
 */
import { randomBytes } from "node:crypto";
import { Prisma, type StatusAssinatura } from "@prisma/client";
import { db } from "@/lib/db";
import { urlSite } from "@/lib/dominios";
import { publicar } from "@/lib/eventos";
import { gatewayPorId, type CobrancaGateway } from "@/lib/pagamentos/gateway";
import { notificarEmSegundoPlano } from "@/lib/whatsapp/conversas";
import { somarMes } from "./regras";

const reais = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBr = (iso: string) => iso.split("-").reverse().join("/");

/** Link absoluto (o simulado usa caminho relativo). Pagamento fica no site, onde o cliente esta logado. */
export function linkAbsoluto(link: string | null) {
  if (!link) return null;
  if (/^https?:\/\//.test(link)) return link;
  return `${urlSite()}${link}`;
}

/** Codigo aleatorio para links publicos de pagamento (nao da para adivinhar). */
export const novoTokenPublico = () => randomBytes(18).toString("base64url");

/** Grava/atualiza a cobranca e recalcula a assinatura. Retorna a transicao de status. */
export async function sincronizarCobranca(cob: CobrancaGateway) {
  const existente = await db.cobranca.findUnique({ where: { gatewayId: cob.id }, select: { assinaturaId: true } });
  const incluir = { cliente: { select: { nome: true, telefone: true } }, plano: { select: { nome: true } } } as const;
  const assinatura = existente
    ? await db.assinatura.findUnique({ where: { id: existente.assinaturaId }, include: incluir })
    : cob.assinaturaGatewayId
      ? await db.assinatura.findUnique({ where: { gatewayId: cob.assinaturaGatewayId }, include: incluir })
      : null;
  if (!assinatura) return null;

  // Detalhes de Pix/boleto so sobrescrevem quando o gateway informou.
  const detalhes = Object.fromEntries(
    Object.entries({
      forma: cob.forma, pixCopiaECola: cob.pixCopiaECola, pixQrUrl: cob.pixQrUrl,
      expiraEm: cob.expiraEm ? new Date(cob.expiraEm) : cob.expiraEm, boletoUrl: cob.boletoUrl, boletoLinha: cob.boletoLinha,
    }).filter(([, v]) => v !== undefined && v !== null),
  );
  const token = novoTokenPublico();
  const salva = await db.cobranca.upsert({
    where: { gatewayId: cob.id },
    create: {
      gatewayId: cob.id, assinaturaId: assinatura.id, valorCentavos: cob.valorCentavos,
      vencimento: new Date(`${cob.vencimento}T00:00:00Z`), status: cob.status,
      pagaEm: cob.pagaEm ? new Date(cob.pagaEm) : null, tokenPublico: token,
      // Sem fatura externa (Pagar.me): o cliente paga na pagina do BarberOS.
      link: cob.link ?? `/c/pagar/${token}`, ...detalhes,
    },
    // O vencimento fica o da criacao (o Pix gerado pelo BarberOS define o mes).
    update: {
      valorCentavos: cob.valorCentavos, status: cob.status, pagaEm: cob.pagaEm ? new Date(cob.pagaEm) : null,
      ...(cob.link ? { link: cob.link } : {}), ...detalhes,
    },
  });

  if (assinatura.status === "CANCELADA") return { de: "CANCELADA" as const, para: "CANCELADA" as const };

  const cobrancas = await db.cobranca.findMany({ where: { assinaturaId: assinatura.id }, orderBy: { vencimento: "asc" } });
  const pagas = cobrancas.filter((c) => c.status === "PAGA");
  const emAberto = cobrancas.filter((c) => c.status === "ATRASADA" || c.status === "ESTORNADA");
  let status: StatusAssinatura = assinatura.status;
  if (emAberto.length) status = pagas.length ? "ATRASADA" : "PENDENTE";
  else if (pagas.length) status = "ATIVA";

  const ultimaPaga = pagas[pagas.length - 1];
  const dados: Prisma.AssinaturaUpdateInput = { status };
  if (ultimaPaga) {
    const venc = ultimaPaga.vencimento.toISOString().slice(0, 10);
    dados.cicloInicio = ultimaPaga.vencimento;
    dados.proximoVencimento = new Date(`${somarMes(venc)}T00:00:00Z`);
  }
  if (status === "ATIVA" && !assinatura.ativadaEm) dados.ativadaEm = new Date();
  await db.assinatura.update({ where: { id: assinatura.id }, data: dados });
  if (status === "ATIVA" && assinatura.status === "PENDENTE") {
    const { aplicarPlanoAosFuturos } = await import("./agenda");
    const cfg = await (await import("@/lib/agenda/carregar")).configuracao();
    await aplicarPlanoAosFuturos(assinatura.clienteId, cfg.fuso);
  }

  // Avisos no WhatsApp so nas mudancas que importam para o cliente.
  const nome = assinatura.cliente.nome.split(" ")[0] || "tudo bem";
  if (cob.status === "PAGA" && assinatura.status !== "ATIVA" && status === "ATIVA") {
    notificarEmSegundoPlano(
      assinatura.cliente.telefone,
      assinatura.status === "PENDENTE"
        ? `Oi, ${nome}! Pagamento confirmado ✅ Seu ${assinatura.plano.nome} está ativo. Já pode marcar seu horário por aqui!`
        : `Oi, ${nome}! Recebemos o pagamento ✅ Seu ${assinatura.plano.nome} voltou a valer normalmente.`,
    );
  }
  if (cob.status === "ATRASADA" && assinatura.status === "ATIVA") {
    const link = linkAbsoluto(salva.link);
    notificarEmSegundoPlano(
      assinatura.cliente.telefone,
      `Oi, ${nome}! A mensalidade do ${assinatura.plano.nome} (${reais(cob.valorCentavos)}, venceu ${dataBr(cob.vencimento)}) ainda não foi paga.` +
        (link ? ` Dá pra pagar por aqui: ${link}` : ""),
    );
  }
  publicar({ tipo: "agenda", barbeiroIds: [], datas: [] });
  return { de: assinatura.status, para: status };
}

/**
 * Evento do gateway (webhook). Processa uma vez so por id de evento e busca a
 * cobranca na API do gateway antes de mudar qualquer coisa.
 */
export async function processarEventoGateway(eventoId: string, tipo: string, cobrancaGatewayId: string) {
  try {
    await db.eventoPagamento.create({ data: { id: eventoId, tipo, cobrancaId: cobrancaGatewayId } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { repetido: true };
    throw e;
  }
  // O id diz o gateway (cobranca antiga da Celcash continua na Celcash).
  const g = await gatewayPorId(cobrancaGatewayId);
  const cob = await g.buscarCobranca(cobrancaGatewayId);
  return { repetido: false, transicao: await sincronizarCobranca(cob) };
}

/** Busca todas as cobrancas da assinatura no gateway (conserta webhook perdido). */
export async function sincronizarAssinatura(assinaturaId: string) {
  const a = await db.assinatura.findUniqueOrThrow({ where: { id: assinaturaId } });
  if (!a.gatewayId) return;
  const g = await gatewayPorId(a.gatewayId);
  for (const c of await g.cobrancasDaAssinatura(a.gatewayId)) await sincronizarCobranca(c);
}

/** Cobranca em aberto mais antiga (para mandar o link). */
export async function cobrancaEmAberto(assinaturaId: string) {
  return db.cobranca.findFirst({
    where: { assinaturaId, status: { in: ["PENDENTE", "ATRASADA", "ESTORNADA"] } },
    orderBy: { vencimento: "asc" },
  });
}

/** Equipe pede para cobrar o cliente pelo WhatsApp. */
export async function cobrarPeloWhatsApp(assinaturaId: string) {
  const a = await db.assinatura.findUniqueOrThrow({
    where: { id: assinaturaId },
    include: { cliente: true, plano: { select: { nome: true } } },
  });
  let c = await cobrancaEmAberto(assinaturaId);
  if (!c) return { enviado: false, motivo: "Não há cobrança em aberto." };
  // Pix expirado nao adianta mandar: gera outro para o mesmo mes.
  if (c.forma === "PIX") c = await (await import("./cartao-pix")).renovarPixSeExpirado(c.id);
  const link = linkAbsoluto(c.link);
  notificarEmSegundoPlano(
    a.cliente.telefone,
    `Oi, ${a.cliente.nome.split(" ")[0]}! Passando pra lembrar da mensalidade do ${a.plano.nome}: ${reais(c.valorCentavos)}, vencimento ${dataBr(c.vencimento.toISOString().slice(0, 10))}.` +
      (link ? ` Link para pagar: ${link}` : "") + " Qualquer dúvida é só responder aqui. 🙂",
  );
  return { enviado: true };
}
