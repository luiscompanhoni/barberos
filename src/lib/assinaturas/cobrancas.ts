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
import { notificarCliente, notificarEmSegundoPlano } from "@/lib/whatsapp/conversas";
import { reservarEnvioPiloto } from "@/lib/whatsapp/piloto";
import { somarMes } from "./regras";
import { conferirVinculoSincronizado } from "@/lib/conciliacao/historico/sincronizacao";
import { confirmarAntesDoEnvio, concluirCobrancaManual, gatewayConfere, reservarCobrancaManual, revisarCobrancaManual } from "./cobranca-automatica";
import { dataLocal } from "@/lib/agenda/tempo";

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

  // Detalhes de Pix/boleto so sobrescrevem quando o gateway informou.
  const detalhes = Object.fromEntries(
    Object.entries({
      forma: cob.forma, pixCopiaECola: cob.pixCopiaECola, pixQrUrl: cob.pixQrUrl,
      expiraEm: cob.expiraEm ? new Date(cob.expiraEm) : cob.expiraEm, boletoUrl: cob.boletoUrl, boletoLinha: cob.boletoLinha,
    }).filter(([, v]) => v !== undefined && v !== null),
  );
  const token = novoTokenPublico();
  const salva = await db.$transaction(async (tx) => {
    const transacaoId = cob.id.match(/^celtx_(\d+)$/)?.[1];
    if (transacaoId) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`conciliacao:celcash:${transacaoId}`}))`;
      // Historico conferido tem sua origem preservada; nao recria o mesmo pagamento sob outro gatewayId.
      if (await conferirVinculoSincronizado(tx, transacaoId, cob)) return null;
    }
    if (!assinatura) return null;
    return tx.cobranca.upsert({
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
  });
  if (!salva || !assinatura) return null;

  if (assinatura.status === "CANCELADA") return { de: "CANCELADA" as const, para: "CANCELADA" as const };

  const cobrancas = await db.cobranca.findMany({ where: { assinaturaId: assinatura.id, vinculosExternos: { none: {} } }, orderBy: { vencimento: "asc" } });
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
    let proximo = somarMes(venc);
    // Pausa empurrou o vencimento: a sincronizacao nao desfaz.
    const atual = assinatura.proximoVencimento?.toISOString().slice(0, 10);
    if (assinatura.pausadaAte && atual && atual > proximo) proximo = atual;
    dados.proximoVencimento = new Date(`${proximo}T00:00:00Z`);
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
  // O aviso legado é separado do atendimento, login e confirmação de pagamento.
  // Não ativar até migrar para uma fila com controle de duplicidade/entrega incerta.
  if (process.env.COBRANCA_LEGADA_WHATSAPP_ATIVA === "true" && cob.status === "ATRASADA" && assinatura.status === "ATIVA") {
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
  // Consulta sem efeito externo de escrita antes de reservar o evento; uma
  // indisponibilidade do gateway não pode marcar o evento como processado.
  const g = await gatewayPorId(cobrancaGatewayId);
  const cob = await g.buscarCobranca(cobrancaGatewayId);
  try {
    await db.eventoPagamento.create({ data: { id: eventoId, tipo, cobrancaId: cobrancaGatewayId } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { repetido: true };
    throw e;
  }
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
    where: { assinaturaId, status: { in: ["PENDENTE", "ATRASADA", "ESTORNADA"] }, vinculosExternos: { none: {} } },
    orderBy: { vencimento: "asc" },
  });
}

/** Equipe pede para cobrar o cliente pelo WhatsApp. */
export async function cobrarPeloWhatsApp(assinaturaId: string) {
  const a = await db.assinatura.findUniqueOrThrow({
    where: { id: assinaturaId },
    include: { cliente: true, plano: { select: { nome: true } } },
  });
  if (a.status === "CANCELADA") return { enviado: false, motivo: "A assinatura está cancelada." };
  if (!a.cliente.aceitaMensagens) return { enviado: false, motivo: "O cliente não aceita mensagens. Não foi enviada cobrança." };
  const c = await cobrancaEmAberto(assinaturaId);
  if (!c) return { enviado: false, motivo: "Não há cobrança em aberto." };
  // Verificar o bloqueio antes de preparar o envio; esse caminho não cria nova cobrança.
  await reservarEnvioPiloto(a.cliente.telefone, "PADRAO");
  // Renovar pode cancelar a cobrança antiga antes de criar outra no gateway. Não fazer isso
  // automaticamente até haver controle de concorrência e reconciliação desse efeito externo.
  if (c.forma === "PIX" && (!c.expiraEm || c.expiraEm.getTime() <= Date.now() + 3_600_000)) {
    return { enviado: false, motivo: "Pix vencido, próximo do vencimento ou com validade desconhecida. Confira a cobrança antes de enviar." };
  }
  if (c.forma === "BOLETO") {
    const fuso = (await db.configuracao.findUnique({ where: { id: 1 }, select: { fuso: true } }))?.fuso ?? "America/Sao_Paulo";
    if (c.vencimento.toISOString().slice(0, 10) < dataLocal(Date.now(), fuso)) return { enviado: false, motivo: "Boleto vencido. Confira a validade no meio de pagamento antes de enviar." };
  }
  const link = linkAbsoluto(c.link);
  if (!link) return { enviado: false, motivo: "A cobrança não possui link de pagamento disponível." };
  const atual = await db.cobranca.findUnique({ where: { id: c.id }, select: { status: true } });
  if (!atual || !["PENDENTE", "ATRASADA", "ESTORNADA"].includes(atual.status)) return { enviado: false, motivo: "A cobrança deixou de estar em aberto. Atualize a tela." };
  const tentativa = await reservarCobrancaManual(c.id);
  if (!tentativa) return { enviado: false, motivo: "Esta fatura já possui tentativa de cobrança ou precisa de revisão. Confira o histórico antes de tentar novamente." };
  try {
    const remota = await (await gatewayPorId(c.gatewayId)).buscarCobranca(c.gatewayId);
    if (!gatewayConfere(tentativa.snapshot, remota, new Date())) throw new Error("Cobrança não confirmada pelo gateway.");
  } catch {
    await revisarCobrancaManual(tentativa.id);
    return { enviado: false, motivo: "Não foi possível confirmar uma cobrança válida no meio de pagamento. Confira antes de enviar." };
  }
  if (!(await confirmarAntesDoEnvio(tentativa.id, tentativa.snapshot))) return { enviado: false, motivo: "Os dados da cobrança ou da preferência do cliente mudaram. Confira antes de enviar." };
  const linkConfirmado = linkAbsoluto(tentativa.snapshot.link);
  if (!linkConfirmado) { await revisarCobrancaManual(tentativa.id); return { enviado: false, motivo: "O link da cobrança não está disponível." }; }
  try {
    const entrega = await notificarCliente(
      tentativa.snapshot.telefone,
      `Oi, ${a.cliente.nome.split(" ")[0]}! Passando pra lembrar da mensalidade do ${a.plano.nome}: ${reais(tentativa.snapshot.valorCentavos)}, vencimento ${dataBr(tentativa.snapshot.vencimento)}.` +
        ` Link para pagar: ${linkConfirmado}` + " Se já pagou, desconsidere. Qualquer dúvida é só responder aqui. 🙂",
    );
    const mensagem = entrega.ok ? await db.mensagem.findUnique({ where: { id: entrega.mensagemId }, select: { wamid: true } }) : null;
    const estado = await concluirCobrancaManual(tentativa.id, mensagem?.wamid ?? null);
    if (estado === "ACEITA") return { enviado: true };
    return { enviado: false, motivo: `${entrega.erro ?? "Não foi possível confirmar o envio."} Confira se a mensagem chegou antes de qualquer nova tentativa.` };
  } catch {
    await concluirCobrancaManual(tentativa.id, null).catch(() => {});
    return { enviado: false, motivo: "O resultado do envio é incerto. Confira a conversa antes de qualquer nova tentativa." };
  }
}
