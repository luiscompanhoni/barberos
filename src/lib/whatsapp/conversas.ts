import { Prisma, type AutorMensagem } from "@prisma/client";
import { db } from "@/lib/db";
import { naoEncontrado } from "@/lib/erros";
import { publicar } from "@/lib/eventos";
import { dentroJanela24h, enviarTemplate, enviarTexto, enviarTextoLoteAutorizado, temJanela24h, type TemplateWhatsApp } from "./canal";
import { instanteDaEntradaCloud } from "./horario-entrada";
import { atualizarPreferencia, travarPreferencia } from "./preferencia";
import { telefoneCanonico } from "./webhook";

/** Conversa do telefone (canonico), ligada ao cliente cadastrado se existir. */
export async function obterConversa(telefone: string, extra: { waId?: string; nomePerfil?: string | null } = {}) {
  const cliente = await db.cliente.findUnique({ where: { telefone }, select: { id: true } });
  return db.conversa.upsert({
    where: { telefone },
    create: { telefone, waId: extra.waId, nomePerfil: extra.nomePerfil ?? undefined, clienteId: cliente?.id },
    update: {
      ...(extra.waId ? { waId: extra.waId } : {}),
      ...(extra.nomePerfil ? { nomePerfil: extra.nomePerfil } : {}),
      ...(cliente ? { clienteId: cliente.id } : {}),
    },
  });
}

/**
 * Guarda a mensagem do cliente. Retorna null se esse wamid ja foi processado
 * (o WhatsApp reenvia webhooks quando nao recebe 200 a tempo).
 */
export async function registrarEntrada(p: { telefone: string; waId?: string; nomePerfil?: string | null; texto: string; wamid?: string; optOut?: boolean; timestampCloud?: number }) {
  const conversa = await obterConversa(p.telefone, { waId: p.waId, nomePerfil: p.nomePerfil });
  const viaCloud = p.timestampCloud !== undefined;
  const ultimaEntradaEm = viaCloud ? instanteDaEntradaCloud(p.timestampCloud!) : new Date(Date.now());
  const where = { id: conversa.id };
  const atualizacoes = (tx: Pick<Prisma.TransactionClient, "conversa">) => [
    tx.conversa.update({ where, data: { naoLidas: { increment: 1 }, ...(!viaCloud && ultimaEntradaEm ? { ultimaEntradaEm } : {}) } }),
    ...(viaCloud && ultimaEntradaEm ? [tx.conversa.updateMany({
      where: { ...where, OR: [{ ultimaEntradaEm: null }, { ultimaEntradaEm: { lt: ultimaEntradaEm } }] },
      data: { ultimaEntradaEm },
    })] : []),
  ];
  try {
    if (p.optOut) {
      // O mesmo lock precede cadastro, recusa e reativação para não perder corridas.
      await db.$transaction(async tx => {
        await travarPreferencia(tx, p.telefone);
        await tx.mensagem.create({ data: { conversaId: conversa.id, autor: "CLIENTE", texto: p.texto, wamid: p.wamid } });
        for (const atualizar of atualizacoes(tx)) await atualizar;
        await atualizarPreferencia(tx, p.telefone, false);
      });
    } else {
      await db.$transaction([
        db.mensagem.create({ data: { conversaId: conversa.id, autor: "CLIENTE", texto: p.texto, wamid: p.wamid } }),
        ...atualizacoes(db),
      ]);
    }
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null;
    throw e;
  }
  publicar({ tipo: "conversa", conversaId: conversa.id });
  return db.conversa.findUniqueOrThrow({ where: { id: conversa.id } });
}

/** A mudança de responsável espera o envio automático em curso para este telefone. */
export function comPreferenciaDaConversa<T>(id: string, executar: (tx: Prisma.TransactionClient) => Promise<T>) {
  return db.$transaction(async tx => {
    const conversa = await tx.conversa.findUnique({ where: { id }, select: { telefone: true } });
    if (!conversa) throw naoEncontrado("Conversa");
    await travarPreferencia(tx, conversa.telefone);
    return executar(tx);
  }, { timeout: 60_000 });
}

/** A caixa da equipe recebe a entrada mesmo quando o transporte está bloqueado. */
export async function encaminharEntradaBloqueada(conversaId: string, texto: string) {
  const mudou = await db.$transaction(async tx => {
    const r = await tx.conversa.updateMany({ where: { id: conversaId, estado: "BOT" }, data: { estado: "HUMANO" } });
    if (!r.count) return false;
    await tx.mensagem.create({ data: { conversaId, autor: "NOTA", texto } });
    return true;
  });
  if (mudou) publicar({ tipo: "conversa", conversaId });
}

/** Envia texto livre numa conversa (dentro da janela de 24h) e registra. */
export async function enviarNaConversa(conversaId: string, texto: string, autor: AutorMensagem, opts: {
  conviteIndividual?: boolean; digitandoMs?: number; entrevistaPiloto?: boolean; respostaAtendimento?: boolean;
  aberturaLote?: { envioId: string; etapa: 0 | 1 }; aberturaTeste?: boolean; pararSeHumano?: boolean;
  campanha?: boolean; templateAberturaCampanha?: TemplateWhatsApp; pagamentoConfirmado?: true;
} = {}) {
  const conversa = await db.conversa.findUniqueOrThrow({ where: { id: conversaId } });
  let erro: string | null = null;
  let wamid: string | null = null;
  try {
    if (autor === "SISTEMA" || opts.aberturaTeste || opts.pararSeHumano) {
      const cliente = await db.cliente.findUnique({ where: { telefone: conversa.telefone }, select: { aceitaMensagens: true, excluidoEm: true } });
      if (conversa.recusaAutomaticas || cliente?.aceitaMensagens === false) throw new Error("O contato pediu para não receber mensagens automáticas.");
      if ((opts.aberturaTeste || opts.pararSeHumano) && (cliente?.excluidoEm || conversa.estado !== "BOT")) {
        throw new Error("Contato indisponível para a abertura automática.");
      }
    }
    const origem = opts.conviteIndividual && opts.pararSeHumano ? "CONVITE_APP" : opts.entrevistaPiloto ? "ENTREVISTA_PILOTO" : autor === "EQUIPE" || (autor === "BOT" && opts.respostaAtendimento) ? "ATENDIMENTO" : autor === "SISTEMA" && opts.pagamentoConfirmado ? "PAGAMENTO_CONFIRMADO" : opts.campanha ? "CAMPANHA" : "PADRAO";
    const destinoCampanha = conversa.waId && telefoneCanonico(conversa.waId) === conversa.telefone ? conversa.waId : conversa.telefone;
    const destino = opts.campanha ? destinoCampanha : opts.entrevistaPiloto ? conversa.telefone : conversa.waId ?? conversa.telefone;
    if (opts.campanha && temJanela24h() && !dentroJanela24h(conversa.ultimaEntradaEm) && !opts.templateAberturaCampanha) {
      throw new Error("A janela de 24h do WhatsApp oficial não está aberta para mensagens livres.");
    }
    const resultado = opts.aberturaLote && autor === "SISTEMA"
      ? await enviarTextoLoteAutorizado(opts.aberturaLote.envioId, conversa, texto, opts.aberturaLote.etapa)
      : opts.templateAberturaCampanha && opts.campanha && autor === "SISTEMA" && temJanela24h()
        ? await enviarTemplate(destino, opts.templateAberturaCampanha, "CAMPANHA")
        : await enviarTexto(destino, texto, opts.digitandoMs, origem);
    wamid = resultado.wamid;
  } catch (e) {
    erro = (e as Error).message;
    console.error(`[whatsapp] falha ao enviar para ${conversa.telefone}:`, erro);
  }
  const m = await db.mensagem.create({ data: { conversaId, autor, texto, wamid, erro } });
  publicar({ tipo: "conversa", conversaId });
  return { ok: !erro, erro, mensagemId: m.id, wamid };
}

/** Avisos da barbearia fora da janela de 24 h podem usar o modelo aprovado para sua finalidade. */
export async function notificarCliente(telefone: string, texto: string, opcoes: { template?: string; apenasTextoLivre?: boolean; pararSeHumano?: boolean; campanha?: boolean; pagamentoConfirmado?: true } = {}) {
  const conversa = await obterConversa(telefone);
  const cliente = conversa.clienteId
    ? await db.cliente.findUnique({ where: { id: conversa.clienteId }, select: { nome: true, aceitaMensagens: true } })
    : null;
  const dentroDaJanela = dentroJanela24h(conversa.ultimaEntradaEm);

  // Válido mesmo antes do cadastro; códigos de acesso usam canal independente.
  const preferencia = await db.conversa.findUnique({ where: { id: conversa.id }, select: { recusaAutomaticas: true } });
  if (preferencia?.recusaAutomaticas || cliente?.aceitaMensagens === false) {
    const erro = "O contato pediu para não receber mensagens automáticas.";
    const m = await db.mensagem.create({ data: { conversaId: conversa.id, autor: "SISTEMA", texto, erro } });
    publicar({ tipo: "conversa", conversaId: conversa.id });
    return { ok: false, erro, mensagemId: m.id };
  }

  if (dentroDaJanela || !temJanela24h()) {
    return enviarNaConversa(conversa.id, texto, "SISTEMA", { pararSeHumano: opcoes.pararSeHumano, campanha: opcoes.campanha, pagamentoConfirmado: opcoes.pagamentoConfirmado });
  }

  const template = opcoes.campanha ? opcoes.template : opcoes.template || process.env.WHATSAPP_TEMPLATE_AVISO;
  let erro: string | null = null;
  let wamid: string | null = null;
  if (opcoes.apenasTextoLivre) {
    erro = "A janela de 24h do WhatsApp oficial não está aberta para mensagens livres.";
  } else if (!template) {
    erro = opcoes.campanha ? "Fora da janela de 24h e sem modelo de campanha aprovado." : "Fora da janela de 24h e WHATSAPP_TEMPLATE_AVISO não configurado: aviso não enviado.";
  } else {
    try {
      const [atual, titular] = await Promise.all([
        db.conversa.findUnique({ where: { id: conversa.id }, select: { recusaAutomaticas: true, estado: true } }),
        db.cliente.findUnique({ where: { telefone }, select: { aceitaMensagens: true, excluidoEm: true } }),
      ]);
      if (atual?.recusaAutomaticas || titular?.aceitaMensagens === false) throw new Error("O contato pediu para não receber mensagens automáticas.");
      if (opcoes.pararSeHumano && (atual?.estado !== "BOT" || titular?.excluidoEm)) throw new Error("Contato indisponível para envio automático.");
      wamid = (await enviarTemplate(conversa.waId ?? telefone, {
        nome: template,
        parametros: [cliente?.nome.split(" ")[0] ?? "cliente", texto],
      }, opcoes.pagamentoConfirmado ? "PAGAMENTO_CONFIRMADO" : opcoes.campanha ? "CAMPANHA" : "TEMPLATE")).wamid;
    } catch (e) {
      erro = (e as Error).message;
    }
  }
  if (erro) console.error(`[whatsapp] aviso para ${telefone}:`, erro);
  const m = await db.mensagem.create({ data: { conversaId: conversa.id, autor: "SISTEMA", texto, wamid, erro } });
  publicar({ tipo: "conversa", conversaId: conversa.id });
  return { ok: !erro, erro, mensagemId: m.id };
}

/** Dispara sem bloquear quem chamou (avisos nao devem travar a agenda). */
export function notificarEmSegundoPlano(telefone: string, texto: string, opcoes?: { pagamentoConfirmado: true }) {
  notificarCliente(telefone, texto, opcoes).catch((e) => console.error("[whatsapp] aviso falhou:", e));
}
