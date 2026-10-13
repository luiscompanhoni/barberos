/**
 * Cancelamento pelo cliente (site e bot) com tentativa de retencao:
 * oferta por motivo (desconto, pausa, gerente), cancelamento no fim do ciclo
 * e a rotina que reativa pausas e encerra os planos cancelados.
 */
import type { OrigemAgendamento, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal, somarDias } from "@/lib/agenda/tempo";
import { gatewayPorId } from "@/lib/pagamentos/gateway";
import { adiarCobranca, aplicarDesconto, capacidades, ehCashbarber } from "@/lib/pagamentos/retencao-gateway";
import { formatarTelefone } from "@/lib/telefone";
import { cancelar } from "./servico";
import { gerarPixDoMes } from "./cartao-pix";
import {
  CONFIG_PADRAO, DIAS_ENTRE_DESCONTOS, DIAS_ENTRE_PAUSAS, ROTULO_MOTIVO, estaPausada, fimDoAcesso, ofertaPara,
  ultimoDia, ultimoVencimentoComDesconto, valorComRetencao, type ConfigRetencao, type Motivo, type Oferta,
} from "./retencao-regras";
import { avisarCliente, avisarDono, dataBr, passarConversaParaEquipe, reais } from "./retencao-avisos";

const DIA_MS = 86_400_000;
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const coluna = (dia: string) => new Date(`${dia}T00:00:00Z`);

export type Pedido = { assinaturaId: string; motivo: Motivo; detalhe?: string | null; origem: OrigemAgendamento; usuarioId?: string | null };

export async function configRetencao(): Promise<ConfigRetencao> {
  const c = await db.retencaoConfig.findUnique({ where: { id: 1 } });
  return c ?? CONFIG_PADRAO;
}

export async function salvarConfigRetencao(c: ConfigRetencao, usuarioId: string | null) {
  return db.$transaction(async (tx) => {
    const r = await tx.retencaoConfig.upsert({ where: { id: 1 }, create: { id: 1, ...c }, update: c });
    await auditar(tx, usuarioId, "configurar", "retencao", "1", c);
    return r;
  });
}

/** Tudo que a decisao precisa: assinatura, oferta, ate quando vale se cancelar. */
async function contexto(assinaturaId: string, motivo: Motivo) {
  const a = await db.assinatura.findUnique({ where: { id: assinaturaId }, include: { cliente: true, plano: true } });
  if (!a) throw naoEncontrado("Assinatura");
  if (a.status === "CANCELADA") throw new ErroNegocio("Esse plano já está cancelado.", 409, "ja_cancelada");
  const cfg = await configuracao();
  const hoje = dataLocal(Date.now(), cfg.fuso);
  const [descontos, pausas] = await Promise.all([
    db.retencaoAssinatura.count({ where: { assinaturaId, desfecho: "DESCONTO", criadoEm: { gt: new Date(Date.now() - DIAS_ENTRE_DESCONTOS * DIA_MS) } } }),
    db.retencaoAssinatura.count({ where: { assinaturaId, desfecho: "PAUSA", criadoEm: { gt: new Date(Date.now() - DIAS_ENTRE_PAUSAS * DIA_MS) } } }),
  ]);
  const pausada = estaPausada({ pausadaEm: a.pausadaEm, pausadaAte: iso(a.pausadaAte), hoje });
  const cap = capacidades(a.gatewayId);
  // Sem vencimento no BarberOS nao da para empurrar nem descontar mensalidade.
  if (!a.proximoVencimento) { cap.pausa = false; cap.desconto = false; }
  const oferta = ofertaPara({
    motivo, status: a.status, pausada, encerrando: !!a.encerraEm, cfg: await configRetencao(), cap,
    historico: { descontoRecente: descontos > 0, pausaRecente: pausas > 0 },
  });
  const fim = fimDoAcesso({
    status: a.status, proximoVencimento: iso(a.proximoVencimento), criadaEm: dataLocal(a.criadaEm, cfg.fuso),
    cashbarber: ehCashbarber(a.gatewayId), hoje,
  });
  return { a, hoje, oferta, fim, pausada, fuso: cfg.fuso };
}

const textoMotivo = (p: Pedido) => `${ROTULO_MOTIVO[p.motivo]}${p.detalhe?.trim() ? `: ${p.detalhe.trim()}` : ""}`;
const primeiroNome = (n: string) => n.split(" ")[0] || "tudo bem";
/** Pelo bot a confirmacao ja sai na propria conversa: nao manda aviso repetido. */
const aoCliente = (p: Pedido, telefone: string, texto: string) => p.origem !== "BOT" && avisarCliente(telefone, texto);

async function registrar(p: Pedido, desfecho: "CANCELOU" | "DESCONTO" | "PAUSA" | "GERENTE", dados: Prisma.InputJsonValue) {
  await db.$transaction(async (tx) => {
    await tx.retencaoAssinatura.create({
      data: { assinaturaId: p.assinaturaId, motivo: p.motivo, detalhe: p.detalhe?.trim() || null, desfecho, origem: p.origem, dados, usuarioId: p.usuarioId ?? null },
    });
    await auditar(tx, p.usuarioId ?? null, `retencao_${desfecho.toLowerCase()}`, "assinatura", p.assinaturaId, { motivo: p.motivo, ...(dados as object) });
  });
}

/** Etapa 2 da tela: a oferta para o motivo e o que acontece se cancelar. */
export async function previaCancelamento(assinaturaId: string, motivo: Motivo) {
  const c = await contexto(assinaturaId, motivo);
  return {
    oferta: c.oferta,
    cancelamento: {
      imediato: !c.fim,
      ultimoDia: c.fim ? ultimoDia(c.fim) : null,
      cashbarber: ehCashbarber(c.a.gatewayId),
    },
    mensalidadeCentavos: c.a.precoCentavos,
  };
}

function exigirOferta<T extends Oferta["tipo"]>(o: Oferta, tipo: T): Extract<Oferta, { tipo: T }> {
  if (o.tipo !== tipo) throw new ErroNegocio("Essa oferta não está disponível para o seu plano.", 409, "sem_oferta");
  return o as Extract<Oferta, { tipo: T }>;
}

/** Aceitou o desconto nas proximas mensalidades. */
export async function aceitarDesconto(p: Pedido) {
  const c = await contexto(p.assinaturaId, p.motivo);
  const o = exigirOferta(c.oferta, "DESCONTO");
  const a = c.a;
  const ate = ultimoVencimentoComDesconto(iso(a.proximoVencimento)!, o.meses);
  try {
    await aplicarDesconto(a.gatewayId!, o.pct, o.meses);
  } catch (e) {
    console.error("[retencao] desconto no gateway:", e);
    throw new ErroNegocio("Não foi possível aplicar o desconto agora. Tente de novo em instantes.", 502, "gateway");
  }
  await db.assinatura.update({ where: { id: a.id }, data: { descontoRetencaoPct: o.pct, descontoRetencaoAte: coluna(ate) } });
  // Pix do proximo mes ja gerado (sem pagar): gera de novo com o desconto.
  const pixAberto = await db.cobranca.findMany({
    where: { assinaturaId: a.id, status: "PENDENTE", forma: "PIX", vencimento: { lte: coluna(ate) }, assinatura: { gatewayId: { startsWith: "pixrec_" } } },
  });
  for (const cob of pixAberto) {
    await (await gatewayPorId(cob.gatewayId)).cancelarCobranca?.(cob.gatewayId).catch((e) => console.error("[retencao] cancelar Pix", e));
    await db.cobranca.update({ where: { id: cob.id }, data: { status: "CANCELADA" } });
    await gerarPixDoMes(a.id, iso(cob.vencimento)!);
  }
  const novo = valorComRetencao({ precoCentavos: a.precoCentavos, vencimento: iso(a.proximoVencimento)!, pct: o.pct, ate });
  await registrar(p, "DESCONTO", { pct: o.pct, meses: o.meses, ate });
  const meses = o.meses === 1 ? "na próxima mensalidade" : `nas próximas ${o.meses} mensalidades`;
  aoCliente(p, a.cliente.telefone,
    `Oi, ${primeiroNome(a.cliente.nome)}! Que bom que você fica com a gente 💈 Seu ${a.plano.nome} ganhou ${o.pct}% de desconto ${meses}: ` +
    `${reais(novo)} em vez de ${reais(a.precoCentavos)} (a partir de ${dataBr(iso(a.proximoVencimento)!)}).`);
  await avisarDono(`💈 Retenção: ${a.cliente.nome} (${formatarTelefone(a.cliente.telefone)}) ia cancelar o ${a.plano.nome} (${textoMotivo(p)}) e aceitou ${o.pct}% de desconto ${meses}.`);
  return { pct: o.pct, meses: o.meses, valorCentavos: novo, ate };
}

/** Pausa por X dias: nao usa o plano e a proxima cobranca anda os mesmos dias (nenhum dia pago se perde). */
export async function pausar(p: Pedido & { dias: number }) {
  const c = await contexto(p.assinaturaId, p.motivo);
  const o = exigirOferta(c.oferta, "PAUSA");
  if (!o.opcoesDias.includes(p.dias)) throw new ErroNegocio("Escolha uma das opções de pausa.", 422, "dias");
  const a = c.a;
  const volta = somarDias(c.hoje, p.dias);
  const marcados = await db.agendamento.findFirst({
    where: { assinaturaId: a.id, status: { in: ["MARCADO", "CONFIRMADO"] }, inicio: { gt: new Date(), lt: coluna(volta) } },
    orderBy: { inicio: "asc" },
  });
  if (marcados) {
    throw new ErroNegocio(`Você tem horário marcado pelo plano em ${dataBr(dataLocal(marcados.inicio, c.fuso))}. Cancele ou remarque antes de pausar.`, 409, "horario_marcado");
  }
  const abertas = await db.cobranca.findMany({ where: { assinaturaId: a.id, status: { in: ["PENDENTE", "ATRASADA"] } } });
  const pixLocal = a.gatewayId?.startsWith("pixrec_");
  if (abertas.some((x) => x.status === "ATRASADA" || !pixLocal)) {
    throw new ErroNegocio("Há uma mensalidade em aberto. Pague antes de pausar ou fale com a barbearia.", 409, "em_aberto");
  }
  const novoVenc = somarDias(iso(a.proximoVencimento)!, p.dias);
  try {
    await adiarCobranca(a.gatewayId!, novoVenc);
  } catch (e) {
    console.error("[retencao] pausa no gateway:", e);
    throw new ErroNegocio("Não foi possível pausar agora. Tente de novo em instantes.", 502, "gateway");
  }
  // Pix do proximo mes ja gerado: cancela (a rotina gera de novo na data nova).
  for (const cob of abertas) {
    await (await gatewayPorId(cob.gatewayId)).cancelarCobranca?.(cob.gatewayId).catch((e) => console.error("[retencao] cancelar Pix", e));
    await db.cobranca.update({ where: { id: cob.id }, data: { status: "CANCELADA" } });
  }
  await db.assinatura.update({
    where: { id: a.id },
    data: {
      pausadaEm: new Date(), pausadaAte: coluna(volta), proximoVencimento: coluna(novoVenc),
      ...(a.descontoRetencaoAte ? { descontoRetencaoAte: coluna(somarDias(iso(a.descontoRetencaoAte)!, p.dias)) } : {}),
    },
  });
  await registrar(p, "PAUSA", { dias: p.dias, volta, proximoVencimento: novoVenc });
  aoCliente(p, a.cliente.telefone,
    `Oi, ${primeiroNome(a.cliente.nome)}! Seu ${a.plano.nome} está pausado por ${p.dias} dias ⏸️ Ele volta sozinho em ${dataBr(volta)} ` +
    `e a próxima mensalidade passa para ${dataBr(novoVenc)}. Nada é cobrado durante a pausa.`);
  await avisarDono(`⏸️ Retenção: ${a.cliente.nome} (${formatarTelefone(a.cliente.telefone)}) ia cancelar o ${a.plano.nome} (${textoMotivo(p)}) e pausou por ${p.dias} dias (volta em ${dataBr(volta)}).`);
  return { volta, proximoVencimento: novoVenc };
}

/** Quer falar com o gerente: a conversa do WhatsApp vai para a equipe, com o motivo. */
export async function falarComGerente(p: Pedido) {
  const c = await contexto(p.assinaturaId, p.motivo);
  const a = c.a;
  await passarConversaParaEquipe(a.cliente.telefone, `Pedido de cancelamento do ${a.plano.nome}: ${textoMotivo(p)}. O cliente quer falar com o gerente.`);
  await registrar(p, "GERENTE", {});
  aoCliente(p, a.cliente.telefone,
    `Oi, ${primeiroNome(a.cliente.nome)}! Recebemos seu pedido sobre o ${a.plano.nome}. O gerente vai falar com você por aqui em breve. Seu plano continua valendo normalmente.`);
  await avisarDono(`📞 ${a.cliente.nome} (${formatarTelefone(a.cliente.telefone)}) quer cancelar o ${a.plano.nome} (${textoMotivo(p)}) e pediu para falar com o gerente. A conversa está em Conversas, aguardando a equipe.`);
  return { ok: true };
}

/**
 * Cancela de verdade. Com mes pago correndo, a recorrencia para agora e o plano vale ate
 * o fim do ciclo (a rotina encerra). CashBarber: so registra e avisa a equipe.
 */
export async function cancelarPeloCliente(p: Pedido) {
  const c = await contexto(p.assinaturaId, p.motivo);
  const a = c.a;
  if (a.encerraEm) throw new ErroNegocio(`Seu plano já está cancelado e vale até ${dataBr(ultimoDia(iso(a.encerraEm)!))}.`, 409, "ja_cancelada");
  const cashbarber = ehCashbarber(a.gatewayId);
  const motivo = textoMotivo(p);
  if (!c.fim) {
    await cancelar(a.id, motivo, p.usuarioId ?? null, { avisar: false, semGateway: cashbarber });
  } else {
    if (a.gatewayId && !cashbarber) {
      try {
        await (await gatewayPorId(a.gatewayId)).cancelarAssinatura(a.gatewayId);
      } catch (e) {
        console.error("[retencao] cancelar no gateway:", e);
        throw new ErroNegocio("Não foi possível cancelar no meio de pagamento. Tente de novo.", 502, "gateway");
      }
      // Mensalidade seguinte ja gerada (Pix do BarberOS): nao vai mais ser cobrada.
      const abertas = await db.cobranca.findMany({ where: { assinaturaId: a.id, status: "PENDENTE", vencimento: { gte: coluna(c.fim) } } });
      for (const cob of abertas) {
        if (a.gatewayId.startsWith("pixrec_")) {
          await (await gatewayPorId(cob.gatewayId)).cancelarCobranca?.(cob.gatewayId).catch((e) => console.error("[retencao] cancelar Pix", e));
        }
        await db.cobranca.update({ where: { id: cob.id }, data: { status: "CANCELADA" } });
      }
    }
    await db.$transaction(async (tx) => {
      await tx.assinatura.update({ where: { id: a.id }, data: { encerraEm: coluna(c.fim!), motivoCancelamento: motivo } });
      await auditar(tx, p.usuarioId ?? null, "agendar_cancelamento", "assinatura", a.id, { motivo, encerraEm: c.fim });
    });
  }
  const ultimo = c.fim ? ultimoDia(c.fim) : null;
  await registrar(p, "CANCELOU", { encerraEm: c.fim, cashbarber });
  aoCliente(p, a.cliente.telefone,
    `Oi, ${primeiroNome(a.cliente.nome)}! Seu ${a.plano.nome} foi cancelado.` +
    (ultimo ? ` Você já pagou este mês, então ele continua valendo até ${dataBr(ultimo)} e não haverá novas cobranças.` : " Não haverá novas cobranças.") +
    " Horários marcados depois disso continuam, como avulsos. Se mudar de ideia, é só chamar aqui. 💈");
  await avisarDono(
    `❌ Cancelamento: ${a.cliente.nome} (${formatarTelefone(a.cliente.telefone)}) cancelou o ${a.plano.nome}. Motivo: ${motivo}.` +
      (ultimo ? ` Vale até ${dataBr(ultimo)}.` : "") +
      (cashbarber ? " ⚠️ Assinatura do CashBarber: cancele também no CashBarber, a cobrança é feita lá." : ""),
  );
  return { imediato: !c.fim, ultimoDia: ultimo, cashbarber };
}

/** Equipe cancelou pelo painel: entra no indicador do mes. */
export async function registrarCancelamentoDaEquipe(assinaturaId: string, motivo: Motivo, detalhe: string | null, usuarioId: string | null) {
  await db.retencaoAssinatura.create({ data: { assinaturaId, motivo, detalhe, desfecho: "CANCELOU", origem: "PAINEL", usuarioId } });
}
