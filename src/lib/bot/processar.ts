import type Anthropic from "@anthropic-ai/sdk";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { publicar } from "@/lib/eventos";
import { configuracao } from "@/lib/agenda/carregar";
import { enviarNaConversa, registrarEntrada } from "@/lib/whatsapp/conversas";
import { situacaoDoCliente } from "@/lib/assinaturas/servico";
import { pediuParar } from "@/lib/automacoes/regras";
import { executarTurno, type Modelo } from "./agente";
import { dividirEmBolhas, tempoDigitando } from "./bolhas";
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

  // "PARAR": desliga as mensagens automaticas na hora, sem passar pelo modelo.
  if (pediuParar(e.texto)) {
    await db.cliente.updateMany({ where: { telefone: conversa.telefone }, data: { aceitaMensagens: false } });
    await enviarNaConversa(conversa.id, "Pronto! Não vou mais mandar lembretes nem novidades. Se precisar marcar, é só chamar aqui. 🙂", "BOT");
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
  const cliente = await db.cliente.findUnique({ where: { telefone: conversa.telefone }, select: { id: true, nome: true } });
  const sit = cliente ? await situacaoDoCliente(cliente.id) : null;
  const plano = sit
    ? `${sit.assinatura.plano.nome} (${sit.assinatura.status === "PENDENTE" ? "aguardando o primeiro pagamento" : sit.valida ? (sit.assinatura.status === "ATRASADA" ? "ativo, com mensalidade atrasada" : "ativo e em dia") : "suspenso por mensalidade atrasada"}${sit.assinatura.plano.descontoExtrasPct ? `; ${sit.assinatura.plano.descontoExtrasPct}% de desconto em avulsos e serviços fora do plano` : ""})`
    : null;

  let resultado;
  try {
    resultado = await executarTurno({
      sistema: promptSistema(cfg),
      historico,
      contexto: contextoDaMensagem({
        agora, fuso: cfg.fuso, inicioDeSessao: historico.length === 0,
        janelaDias: cfg.janelaAgendamentoDias, cliente: cliente?.nome.trim() ? cliente : null, nomePerfil: conversa.nomePerfil, plano,
        avisos: await avisosRecentes(conversa.id, agora),
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
  // Em bolhas curtas, com "digitando..." antes de cada uma (como uma pessoa no WhatsApp).
  for (const bolha of dividirEmBolhas(resultado.resposta)) {
    await enviarNaConversa(conversa.id, bolha, "BOT", { digitandoMs: tempoDigitando(bolha) });
  }
}

/** Mensagens automaticas (SISTEMA) desde a fala anterior do cliente: o lembrete que ele esta respondendo. */
async function avisosRecentes(conversaId: string, agora: number) {
  const recentes = await db.mensagem.findMany({
    where: { conversaId, criadoEm: { gt: new Date(agora - 48 * 3_600_000) } },
    orderBy: { criadoEm: "desc" },
    take: 15,
    select: { autor: true, texto: true },
  });
  const avisos: string[] = [];
  let passouAtual = false;
  for (const m of recentes) {
    if (!passouAtual) {
      passouAtual = m.autor === "CLIENTE"; // a primeira mensagem do cliente e a que chegou agora
      continue;
    }
    if (m.autor === "CLIENTE") break;
    if (m.autor === "SISTEMA") avisos.push(m.texto);
  }
  return avisos.slice(0, 3).reverse();
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
