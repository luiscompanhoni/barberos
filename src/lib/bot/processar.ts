import type Anthropic from "@anthropic-ai/sdk";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { publicar } from "@/lib/eventos";
import { configuracao } from "@/lib/agenda/carregar";
import { enviarNaConversa, registrarEntrada } from "@/lib/whatsapp/conversas";
import { executarTurno, type Modelo } from "./agente";
import { contextoDaMensagem, promptSistema } from "./prompt";

/** Sessao com o modelo reinicia depois desse tempo sem mensagens (ou se ficar longa demais). */
const SESSAO_INATIVA_MS = 3 * 3_600_000;
const SESSAO_MAX_MENSAGENS = 60;

// Uma mensagem por vez por conversa (o cliente costuma mandar varias seguidas).
const g = globalThis as unknown as { filaConversas?: Map<string, Promise<unknown>> };
const filas = (g.filaConversas ??= new Map());

function naFila<T>(chave: string, fn: () => Promise<T>): Promise<T> {
  const anterior = filas.get(chave) ?? Promise.resolve();
  const atual = anterior.catch(() => {}).then(fn);
  filas.set(chave, atual);
  atual.finally(() => { if (filas.get(chave) === atual) filas.delete(chave); }).catch(() => {});
  return atual;
}

export type Entrada = { telefone: string; waId?: string; nomePerfil?: string | null; texto: string | null; wamid?: string };

/** Mensagem que chegou (webhook ou simulador) -> registra, responde com o bot se for o caso. */
export function receberMensagem(e: Entrada, opts: { modelo?: Modelo } = {}) {
  return naFila(e.telefone, () => processar(e, opts));
}

async function processar(e: Entrada, opts: { modelo?: Modelo }) {
  const texto = e.texto ?? "[mensagem que não e texto: áudio, foto, figurinha ou documento]";
  const conversa = await registrarEntrada({ ...e, texto });
  if (!conversa) return; // repetida
  const cfg = await configuracao();
  if (!cfg.botAtivo || conversa.estado === "HUMANO") return; // equipe responde pelo painel

  if (!e.texto) {
    await enviarNaConversa(conversa.id, "Por enquanto só consigo ler mensagens de texto. Pode me escrever o que precisa? 🙂", "BOT");
    return;
  }

  const agora = Date.now();
  const sessaoValida =
    conversa.sessao &&
    conversa.sessaoInicioEm &&
    conversa.ultimaEntradaEm &&
    Array.isArray(conversa.sessao) &&
    conversa.sessao.length < SESSAO_MAX_MENSAGENS &&
    agora - (await ultimaAtividade(conversa.id)) < SESSAO_INATIVA_MS;
  const historico = sessaoValida ? (conversa.sessao as unknown as Anthropic.Beta.BetaMessageParam[]) : [];
  const cliente = await db.cliente.findUnique({ where: { telefone: conversa.telefone }, select: { nome: true } });

  let resultado;
  try {
    resultado = await executarTurno({
      sistema: promptSistema(cfg),
      historico,
      contexto: contextoDaMensagem({
        agora, fuso: cfg.fuso, inicioDeSessao: historico.length === 0,
        janelaDias: cfg.janelaAgendamentoDias, cliente: cliente?.nome.trim() ? cliente : null, nomePerfil: conversa.nomePerfil,
      }),
      texto: e.texto,
      ctx: { conversaId: conversa.id, telefone: conversa.telefone, nomePerfil: conversa.nomePerfil },
      modelo: opts.modelo,
    });
  } catch (err) {
    console.error("[bot] falha ao chamar o modelo:", err);
    await passarParaEquipe(conversa.id, `Bot indisponível: ${(err as Error).message}`);
    await enviarNaConversa(conversa.id, "Opa! Tive um problema aqui. Já chamei alguém da equipe para te responder. 🙏", "BOT");
    return;
  }

  if (resultado.recusado) {
    await passarParaEquipe(conversa.id, "O modelo recusou responder essa mensagem.");
    await db.conversa.update({ where: { id: conversa.id }, data: { sessao: [] } });
    await enviarNaConversa(conversa.id, "Vou pedir para alguém da equipe te responder, tudo bem? 🙂", "BOT");
    return;
  }

  await db.conversa.update({
    where: { id: conversa.id },
    data: {
      sessao: resultado.historico as unknown as Prisma.InputJsonValue,
      sessaoInicioEm: historico.length ? conversa.sessaoInicioEm : new Date(),
      ...(resultado.passouParaHumano ? { estado: "HUMANO" } : {}),
    },
  });
  if (resultado.resposta) await enviarNaConversa(conversa.id, resultado.resposta, "BOT");
}

/** Hora da mensagem anterior a atual (para saber se a sessao "esfriou"). */
async function ultimaAtividade(conversaId: string) {
  const ultimas = await db.mensagem.findMany({ where: { conversaId }, orderBy: { criadoEm: "desc" }, take: 2, select: { criadoEm: true } });
  return (ultimas[1] ?? ultimas[0])?.criadoEm.getTime() ?? 0;
}

async function passarParaEquipe(conversaId: string, motivo: string) {
  await db.conversa.update({ where: { id: conversaId }, data: { estado: "HUMANO" } });
  await db.mensagem.create({ data: { conversaId, autor: "NOTA", texto: motivo } });
  publicar({ tipo: "conversa", conversaId });
}
