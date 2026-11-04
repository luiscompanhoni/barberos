import { Prisma, type AutorMensagem } from "@prisma/client";
import { db } from "@/lib/db";
import { publicar } from "@/lib/eventos";
import { enviarTemplate, enviarTexto, temJanela24h } from "./canal";
import { atualizarPreferencia, travarPreferencia } from "./preferencia";

const JANELA_24H_MS = 24 * 3_600_000;

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
export async function registrarEntrada(p: { telefone: string; waId?: string; nomePerfil?: string | null; texto: string; wamid?: string; optOut?: boolean }) {
  const conversa = await obterConversa(p.telefone, { waId: p.waId, nomePerfil: p.nomePerfil });
  try {
    if (p.optOut) {
      // O mesmo lock precede cadastro, recusa e reativação para não perder corridas.
      await db.$transaction(async tx => {
        await travarPreferencia(tx, p.telefone);
        await tx.mensagem.create({ data: { conversaId: conversa.id, autor: "CLIENTE", texto: p.texto, wamid: p.wamid } });
        await tx.conversa.update({ where: { id: conversa.id }, data: { ultimaEntradaEm: new Date(), naoLidas: { increment: 1 } } });
        await atualizarPreferencia(tx, p.telefone, false);
      });
    } else {
      await db.$transaction([
        db.mensagem.create({ data: { conversaId: conversa.id, autor: "CLIENTE", texto: p.texto, wamid: p.wamid } }),
        db.conversa.update({ where: { id: conversa.id }, data: { ultimaEntradaEm: new Date(), naoLidas: { increment: 1 } } }),
      ]);
    }
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null;
    throw e;
  }
  publicar({ tipo: "conversa", conversaId: conversa.id });
  return db.conversa.findUniqueOrThrow({ where: { id: conversa.id } });
}

/** Envia texto livre numa conversa (dentro da janela de 24h) e registra. */
export async function enviarNaConversa(conversaId: string, texto: string, autor: AutorMensagem, opts: { digitandoMs?: number; entrevistaPiloto?: boolean; respostaAtendimento?: boolean } = {}) {
  const conversa = await db.conversa.findUniqueOrThrow({ where: { id: conversaId } });
  let erro: string | null = null;
  let wamid: string | null = null;
  try {
    if (autor === "SISTEMA") {
      const cliente = await db.cliente.findUnique({ where: { telefone: conversa.telefone }, select: { aceitaMensagens: true } });
      if (conversa.recusaAutomaticas || cliente?.aceitaMensagens === false) throw new Error("O contato pediu para não receber mensagens automáticas.");
    }
    const origem = opts.entrevistaPiloto ? "ENTREVISTA_PILOTO" : autor === "EQUIPE" || (autor === "BOT" && opts.respostaAtendimento) ? "ATENDIMENTO" : "PADRAO";
    wamid = (await enviarTexto(opts.entrevistaPiloto ? conversa.telefone : conversa.waId ?? conversa.telefone, texto, opts.digitandoMs, origem)).wamid;
  } catch (e) {
    erro = (e as Error).message;
    console.error(`[whatsapp] falha ao enviar para ${conversa.telefone}:`, erro);
  }
  const m = await db.mensagem.create({ data: { conversaId, autor, texto, wamid, erro } });
  publicar({ tipo: "conversa", conversaId });
  return { ok: !erro, erro, mensagemId: m.id };
}

/**
 * Aviso iniciado pela barbearia (remarcacao, cancelamento...). Dentro da janela
 * de 24h vai como texto; fora dela o WhatsApp exige um template aprovado.
 */
export async function notificarCliente(telefone: string, texto: string) {
  const conversa = await obterConversa(telefone);
  const cliente = conversa.clienteId
    ? await db.cliente.findUnique({ where: { id: conversa.clienteId }, select: { nome: true, aceitaMensagens: true } })
    : null;
  const dentroDaJanela = !!conversa.ultimaEntradaEm && Date.now() - conversa.ultimaEntradaEm.getTime() < JANELA_24H_MS;

  // Válido mesmo antes do cadastro; códigos de acesso usam canal independente.
  const preferencia = await db.conversa.findUnique({ where: { id: conversa.id }, select: { recusaAutomaticas: true } });
  if (preferencia?.recusaAutomaticas || cliente?.aceitaMensagens === false) {
    const erro = "O contato pediu para não receber mensagens automáticas.";
    const m = await db.mensagem.create({ data: { conversaId: conversa.id, autor: "SISTEMA", texto, erro } });
    publicar({ tipo: "conversa", conversaId: conversa.id });
    return { ok: false, erro, mensagemId: m.id };
  }

  if (dentroDaJanela || !temJanela24h()) {
    return enviarNaConversa(conversa.id, texto, "SISTEMA");
  }

  const template = process.env.WHATSAPP_TEMPLATE_AVISO;
  let erro: string | null = null;
  let wamid: string | null = null;
  if (!template) {
    erro = "Fora da janela de 24h e WHATSAPP_TEMPLATE_AVISO não configurado: aviso não enviado.";
  } else {
    try {
      const [atual, titular] = await Promise.all([
        db.conversa.findUnique({ where: { id: conversa.id }, select: { recusaAutomaticas: true } }),
        db.cliente.findUnique({ where: { telefone }, select: { aceitaMensagens: true } }),
      ]);
      if (atual?.recusaAutomaticas || titular?.aceitaMensagens === false) throw new Error("O contato pediu para não receber mensagens automáticas.");
      wamid = (await enviarTemplate(conversa.waId ?? telefone, {
        nome: template,
        parametros: [cliente?.nome.split(" ")[0] ?? "cliente", texto],
      })).wamid;
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
export function notificarEmSegundoPlano(telefone: string, texto: string) {
  notificarCliente(telefone, texto).catch((e) => console.error("[whatsapp] aviso falhou:", e));
}
