import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { auditar } from "@/lib/auditoria";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { publicar } from "@/lib/eventos";
import { pediuParar } from "@/lib/automacoes/regras";
import { instanteDaEntradaCloud } from "@/lib/whatsapp/horario-entrada";
import { dentroJanelaInstagram, enviarTextoInstagram, partesInstagram } from "./canal";
import { telefoneDoDirect, textoDaEquipeNoDirect, textoSeguroDoDirect } from "./privacidade";
import type { EntradaInstagram } from "./protocolo";
import { ENVIO_INSTAGRAM_SIMULADO } from "./status";

const idExterno = (valor: string) => `instagram:${valor}`;
const ENVIO_PENDENTE = "Envio pendente de confirmação. Confira no Direct antes de reenviar.";
const ordemEntrada = [{ criadoEm: "desc" }, { id: "desc" }] as const;
const selecionarConversa = { id: true, instagramIgsid: true, estado: true, ultimaEntradaEm: true, sessaoInicioEm: true, recusaAutomaticas: true } as const;

type ConversaInstagram = Prisma.ConversaGetPayload<{ select: typeof selecionarConversa }>;
type TurnoInstagram = { conversaId: string; mid: string; timestamp: number };
type IdentificadorEntrada = Pick<TurnoInstagram, "conversaId" | "mid">;
export type EntradaRegistradaInstagram = TurnoInstagram & { texto: string | null };
type EnvioBot = { autor: "BOT"; entrada: EntradaRegistradaInstagram; encaminhar?: string };
type EnvioEquipe = { autor: "EQUIPE"; envioId: string; usuarioId: string };

const filtroDaEntrada = (entrada: IdentificadorEntrada) => ({ conversaId: entrada.conversaId, wamid: idExterno(entrada.mid), autor: "CLIENTE" as const });

export async function travarInboxInstagram(tx: Prisma.TransactionClient, igsid: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`inbox-instagram:${igsid}`}, 0))`;
}

export async function registrarEntradaInstagram(entrada: EntradaInstagram): Promise<EntradaRegistradaInstagram | null> {
  const instante = instanteDaEntradaCloud(entrada.timestamp);
  if (!instante) return null;
  const telefone = entrada.texto ? telefoneDoDirect(entrada.texto) : null;
  const texto = entrada.texto ? textoSeguroDoDirect(entrada.texto) : null;
  const recusa = !!entrada.texto && pediuParar(entrada.texto);
  const wamid = idExterno(entrada.mid);
  let registrada: EntradaRegistradaInstagram | null;
  try {
    registrada = await db.$transaction(async tx => {
      // A exclusão do titular usa a mesma trava ao desvincular o telefone.
      if (telefone) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cliente-ciclo-telefone:${telefone}`}))`;
      await travarInboxInstagram(tx, entrada.igsid);
      if (await tx.mensagem.findUnique({ where: { wamid }, select: { id: true } })) return null;
      const conversa = await tx.conversa.upsert({
        where: { instagramIgsid: entrada.igsid },
        create: { telefone: idExterno(entrada.igsid), instagramIgsid: entrada.igsid },
        update: {},
        select: { id: true, ultimaEntradaEm: true, instagramClienteId: true },
      });
      const ultima = !conversa.ultimaEntradaEm || +conversa.ultimaEntradaEm <= entrada.timestamp;
      const cliente = telefone && ultima && !conversa.instagramClienteId
        ? await tx.cliente.findUnique({ where: { telefone, excluidoEm: null }, select: { id: true } }) : null;
      await tx.mensagem.create({ data: {
        conversaId: conversa.id, autor: "CLIENTE", texto: texto ?? "[Mídia do Direct. Confira no Instagram.]", wamid, criadoEm: instante,
        instagramPendenteEm: new Date(),
      } });
      await tx.conversa.update({ where: { id: conversa.id }, data: {
        naoLidas: { increment: 1 },
        ...(ultima ? { ultimaEntradaEm: instante } : {}),
        ...(cliente ? { instagramClienteId: cliente.id } : {}),
        ...(recusa ? { recusaAutomaticas: true } : {}),
      } });
      if (recusa) {
        const alteradas = await tx.conversa.updateMany({ where: { id: conversa.id, estado: "BOT" }, data: { estado: "HUMANO", sessaoInicioEm: new Date() } });
        if (alteradas.count) await tx.mensagem.create({ data: { conversaId: conversa.id, autor: "NOTA", texto: "O contato pediu para parar de receber respostas automáticas pelo Direct." } });
      }
      return { conversaId: conversa.id, texto, mid: entrada.mid, timestamp: entrada.timestamp };
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002" && await db.mensagem.findUnique({ where: { wamid }, select: { id: true } })) return null;
    throw erro;
  }
  if (registrada) publicar({ tipo: "conversa", conversaId: registrada.conversaId });
  return registrada;
}

export async function lerConversaInstagram(id: string, acesso: Pick<Prisma.TransactionClient, "conversa"> = db) {
  const conversa = await acesso.conversa.findUnique({ where: { id }, select: selecionarConversa });
  return conversa?.instagramIgsid ? { ...conversa, instagramIgsid: conversa.instagramIgsid } : null;
}

export async function turnoInstagramAtual(conversa: ConversaInstagram | null, entrada: TurnoInstagram, acesso: Pick<Prisma.TransactionClient, "mensagem"> = db) {
  if (!conversa || conversa.estado !== "BOT" || conversa.ultimaEntradaEm?.getTime() !== entrada.timestamp ||
    (conversa.sessaoInicioEm && +conversa.sessaoInicioEm >= entrada.timestamp)) return false;
  // Empates no relógio da Meta têm um único turno, inclusive em lotes concorrentes.
  const ultimaEntrada = await acesso.mensagem.findFirst({
    where: { conversaId: conversa.id, autor: "CLIENTE", criadoEm: conversa.ultimaEntradaEm! },
    orderBy: [...ordemEntrada], select: { wamid: true },
  });
  return ultimaEntrada?.wamid === idExterno(entrada.mid);
}

async function comInboxInstagram<T>(id: string, executar: (tx: Prisma.TransactionClient, atual: ConversaInstagram & { instagramIgsid: string }) => Promise<T>) {
  return db.$transaction(async tx => {
    const inicial = await lerConversaInstagram(id, tx);
    if (!inicial) throw naoEncontrado("Conversa do Instagram");
    await travarInboxInstagram(tx, inicial.instagramIgsid);
    const atual = await lerConversaInstagram(id, tx);
    if (!atual) throw naoEncontrado("Conversa do Instagram");
    return executar(tx, atual);
  }, { timeout: 30_000 });
}

async function transferirParaEquipe(tx: Prisma.TransactionClient, id: string, nota: string) {
  await tx.conversa.update({ where: { id }, data: { estado: "HUMANO", sessaoInicioEm: new Date() } });
  await tx.mensagem.create({ data: { conversaId: id, autor: "NOTA", texto: nota } });
}

export async function encaminharEntradaInstagram(entrada: EntradaRegistradaInstagram, nota: string) {
  const mudou = await comInboxInstagram(entrada.conversaId, async (tx, atual) => {
    if (!await turnoInstagramAtual(atual, entrada, tx)) return false;
    await transferirParaEquipe(tx, atual.id, nota);
    return true;
  });
  if (mudou) publicar({ tipo: "conversa", conversaId: entrada.conversaId });
}

export async function concluirEntradaInstagram(entrada: IdentificadorEntrada, acesso: Pick<Prisma.TransactionClient, "mensagem"> = db) {
  await acesso.mensagem.updateMany({
    where: { ...filtroDaEntrada(entrada), instagramPendenteEm: { not: null } },
    data: { instagramPendenteEm: null },
  });
}

export async function recuperarEntradaInstagramPendente(entrada: TurnoInstagram, limite: Date) {
  const encaminhou = await comInboxInstagram(entrada.conversaId, async (tx, atual) => {
    const pendencia = await tx.mensagem.updateMany({
      where: { ...filtroDaEntrada(entrada), instagramPendenteEm: { lte: limite } },
      data: { instagramPendenteEm: null },
    });
    if (!pendencia.count || !await turnoInstagramAtual(atual, entrada, tx)) return false;
    await transferirParaEquipe(tx, atual.id, "O atendimento automático do Direct ficou pendente. A equipe pode continuar por aqui.");
    return true;
  });
  if (encaminhou) publicar({ tipo: "conversa", conversaId: entrada.conversaId });
  return encaminhou;
}

export function enviarRespostaEquipeInstagram(conversaId: string, texto: string, usuarioId: string, envioId = crypto.randomUUID()) {
  return enviarRespostaInstagram(conversaId, textoDaEquipeNoDirect(texto), { autor: "EQUIPE", usuarioId, envioId });
}

export async function enviarRespostaInstagram(conversaId: string, texto: string, envio: EnvioBot | EnvioEquipe) {
  const partes = partesInstagram(texto).map(parte => parte.trim()).filter(Boolean);
  if (!partes.length) throw new ErroNegocio("Escreva uma mensagem para enviar pelo Direct.");
  const chave = envio.autor === "BOT" ? envio.entrada.mid : envio.envioId;
  const mensagemId = createHash("sha256").update(JSON.stringify([conversaId, envio.autor, chave])).digest("hex");
  const hashTexto = createHash("sha256").update(texto).digest("hex");
  const reserva = await comInboxInstagram(conversaId, async (tx, atual) => {
    const anterior = await tx.mensagem.findUnique({ where: { id: mensagemId }, select: { erro: true } });
    if (anterior) {
      if (envio.autor === "EQUIPE") {
        const mesmaMensagem = await tx.auditoria.findFirst({ where: {
          acao: "instagram_resposta_equipe", entidade: "conversa", entidadeId: conversaId,
          AND: [{ dados: { path: ["mensagemId"], equals: mensagemId } }, { dados: { path: ["hashTexto"], equals: hashTexto } }],
        }, select: { id: true } });
        if (!mesmaMensagem) throw new ErroNegocio("Este identificador de envio já foi usado. Confira no Direct antes de reenviar.", 409);
      }
      return { repetida: true, erro: anterior.erro } as const;
    }
    if (envio.autor === "BOT") {
      if (atual.recusaAutomaticas || !await turnoInstagramAtual(atual, envio.entrada, tx) || !dentroJanelaInstagram(atual.ultimaEntradaEm)) return null;
    } else {
      if (!dentroJanelaInstagram(atual.ultimaEntradaEm)) throw new ErroNegocio("A janela de 24h do Instagram fechou. Aguarde uma nova mensagem pelo Direct.", 422);
      if (atual.estado !== "HUMANO") await transferirParaEquipe(tx, conversaId, "A equipe assumiu ao responder pelo Direct.");
      await auditar(tx, envio.usuarioId, "instagram_resposta_equipe", "conversa", conversaId, { mensagemId, hashTexto });
    }
    // A reserva persistida impede reenvio automático se o processo cair após chamar a Meta.
    await tx.mensagem.create({ data: { id: mensagemId, conversaId, autor: envio.autor, texto, erro: ENVIO_PENDENTE } });
    return { repetida: false } as const;
  });
  if (!reserva) return null;
  if (reserva.repetida) return resultadoEnvio(reserva.erro);
  const erro = await comInboxInstagram(conversaId, async (tx, atual) => {
    if (envio.autor === "BOT" && (atual.recusaAutomaticas || !await turnoInstagramAtual(atual, envio.entrada, tx))) {
      await tx.mensagem.delete({ where: { id: mensagemId } });
      return null;
    }
    if (envio.autor === "BOT" && (await tx.configuracao.findUnique({ where: { id: 1 }, select: { botAtivo: true } }))?.botAtivo === false) {
      await tx.mensagem.delete({ where: { id: mensagemId } });
      await transferirParaEquipe(tx, conversaId, "Operação do Leonel pausada. A equipe pode continuar pelo Direct.");
      return null;
    }
    let erroParte: string | null = null;
    const sinal = AbortSignal.timeout(12_000);
    for (const [i, parte] of partes.entries()) {
      let wamid: string | null = null;
      let erro: string | null = null;
      if (!dentroJanelaInstagram(atual.ultimaEntradaEm)) erro = "A janela de 24h do Instagram fechou.";
      else if (envio.autor === "EQUIPE" && atual.estado !== "HUMANO") erro = "A conversa voltou ao bot antes do envio.";
      else {
        try {
          const resposta = await enviarTextoInstagram({ igsid: atual.instagramIgsid, texto: parte, sinal });
          wamid = resposta.mid ? idExterno(resposta.mid) : null;
          erro = resposta.simulado ? ENVIO_INSTAGRAM_SIMULADO : null;
        } catch (falha) { erro = (falha as Error).message; }
      }
      const falhou = erro && erro !== ENVIO_INSTAGRAM_SIMULADO;
      const data = { texto: falhou ? partes.slice(i).join("\n") : parte, wamid, erro };
      if (i === 0) await tx.mensagem.update({ where: { id: mensagemId }, data });
      else await tx.mensagem.create({ data: { ...data, conversaId, autor: envio.autor } });
      erroParte = erro;
      if (falhou) break;
    }
    // Marque o primeiro registro ao repetir uma tentativa que teve falha parcial.
    if (partes.length > 1 && erroParte && erroParte !== ENVIO_INSTAGRAM_SIMULADO) {
      await tx.mensagem.updateMany({ where: { id: mensagemId, erro: null }, data: { erro: "Envio parcial. Confira as mensagens abaixo e no Direct." } });
    }
    if (envio.autor === "BOT" && erroParte && erroParte !== ENVIO_INSTAGRAM_SIMULADO) {
      await transferirParaEquipe(tx, conversaId, "A resposta automática pelo Direct falhou. A equipe pode continuar por aqui.");
    } else if (envio.autor === "BOT" && envio.encaminhar) {
      await transferirParaEquipe(tx, conversaId, envio.encaminhar);
    } else {
      await tx.conversa.update({ where: { id: conversaId }, data: { atualizadoEm: new Date() } });
    }
    if (envio.autor === "BOT") await concluirEntradaInstagram(envio.entrada, tx);
    return erroParte;
  });
  publicar({ tipo: "conversa", conversaId });
  return resultadoEnvio(erro);
}

function resultadoEnvio(erro: string | null) {
  const simulado = erro === ENVIO_INSTAGRAM_SIMULADO;
  return { ok: !erro || simulado, simulado, erro: simulado ? null : erro };
}
