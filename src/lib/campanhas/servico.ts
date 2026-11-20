/**
 * Campanhas no WhatsApp por segmento da base: o dono (ou gerente) libera lotes do tamanho que a agenda aguenta e a
 * rotina das automacoes manda aos poucos, no horario comercial, sem passar do limite diario da campanha.
 */
import { randomBytes } from "node:crypto";
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal, instanteLocal, somarDias } from "@/lib/agenda/tempo";
import { horarioComercial } from "@/lib/automacoes/regras";
import { auditar } from "@/lib/auditoria";
import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { urlSite } from "@/lib/dominios";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { noAr } from "@/lib/jogos/motor";
import { notificarCliente } from "@/lib/whatsapp/conversas";
import { estadoPiloto } from "@/lib/whatsapp/piloto";
import { campanhasManuaisAposPiloto, recursoPiloto } from "@/lib/whatsapp/piloto-regras";
import { testeEquipeAtivo } from "@/lib/whatsapp/teste-equipe";
import { quarentenaRestauracao } from "@/lib/recuperacao/quarentena";
import { CHAVES_SEGMENTO, montarMensagem, segmentosDoCliente, SEGMENTOS, type Segmento } from "./regras";
import { impedimentoCampanha } from "./contato";
import { campanhaConferida, identificadorDoLote, loteAutorizadoConfirmado, loteAutorizadoDisponivel } from "./lote-autorizado";
import { INTERVALO_CAMPANHAS_MS, migracaoDoCliente, reservarContatoCampanha } from "./reservar-contato";
import { contagemDeClientesAtribuidos, resumoDosEnvios } from "./atribuicao";
import { MODELOS_SEGMENTOS } from "./modelos-segmento";

export async function campanhasBloqueadas() {
  return process.env.WHATSAPP_ENVIOS_BLOQUEADOS === "true" || quarentenaRestauracao() || testeEquipeAtivo() ||
    (recursoPiloto() && (process.env.WHATSAPP_CAMPANHAS_MANUAIS_ATIVAS !== "true" || !campanhasManuaisAposPiloto(await estadoPiloto())));
}

async function exigirCampanhaLiberada() {
  if (await campanhasBloqueadas()) throw new ErroNegocio("Envios de campanhas bloqueados nesta instalação.", 409, "campanhas_bloqueadas");
}

/** Quantas mensagens de campanha saem por rodada da rotina (a cada 5 min), somando todas: espalha o envio. */
const MAX_POR_RODADA = 20;

type ClienteBase = { id: string; aceitaMensagens: boolean; bloqueado: boolean; temFuturo: boolean; ultima: number | null; segmentos: Segmento[] };

/** Cada cliente com os segmentos em que esta, se aceita mensagens e se ja tem horario marcado. */
async function base(agora: number): Promise<ClienteBase[]> {
  const [clientes, visitas, assinaturas, futuros] = await Promise.all([
    db.cliente.findMany({ select: { id: true, aceitaMensagens: true, excluidoEm: true, conversa: { select: { estado: true, recusaAutomaticas: true } }, assinaturas: migracaoDoCliente } }),
    db.agendamento.groupBy({ by: ["clienteId"], where: { status: "CONCLUIDO" }, _max: { inicio: true }, _min: { inicio: true } }),
    db.assinatura.findMany({ select: { clienteId: true, status: true } }),
    db.agendamento.findMany({ where: { status: { in: ["MARCADO", "CONFIRMADO"] }, inicio: { gt: new Date(agora) } }, select: { clienteId: true }, distinct: ["clienteId"] }),
  ]);
  const v = new Map(visitas.map((x) => [x.clienteId, x]));
  const plano = new Map<string, "ativa" | "ex">();
  for (const a of assinaturas) {
    if (a.status === "ATIVA" || a.status === "ATRASADA") plano.set(a.clienteId, "ativa");
    else if (a.status === "CANCELADA" && !plano.has(a.clienteId)) plano.set(a.clienteId, "ex");
  }
  const comFuturo = new Set(futuros.map((f) => f.clienteId));
  return clientes.map((c) => {
    const ultima = v.get(c.id)?._max.inicio?.getTime() ?? null;
    const primeira = v.get(c.id)?._min.inicio?.getTime() ?? null;
    return { id: c.id, aceitaMensagens: c.aceitaMensagens, bloqueado: !!impedimentoCampanha(c), temFuturo: comFuturo.has(c.id), ultima, segmentos: segmentosDoCliente({ ultima, primeira, assinatura: plano.get(c.id) ?? null }, agora) };
  });
}

const podeReceber = (c: ClienteBase) => !c.bloqueado && !c.temFuturo;

/** Tamanho de cada segmento e quantos podem receber agora (aceitam mensagens e nao tem horario marcado). */
export async function resumoSegmentos(agora = Date.now()) {
  const b = await base(agora);
  return {
    clientes: b.length,
    aceitamMensagens: b.filter((c) => c.aceitaMensagens).length,
    segmentos: SEGMENTOS.map((s) => {
      const doSeg = b.filter((c) => c.segmentos.includes(s.chave));
      return { chave: s.chave, rotulo: s.rotulo, total: doSeg.length, podemReceber: doSeg.filter(podeReceber).length };
    }),
  };
}

/** Quem a campanha ainda pode chamar: esta em algum dos segmentos, pode receber e nao entrou em lote anterior. Mais recentes primeiro. */
async function elegiveis(segmentos: string[], campanhaId: string | null, agora: number, so?: string[]) {
  const ja = campanhaId ? new Set((await db.campanhaEnvio.findMany({ where: { campanhaId }, select: { clienteId: true } })).map((e) => e.clienteId)) : new Set<string>();
  return (await base(agora))
    .filter((c) => podeReceber(c) && !ja.has(c.id) && c.segmentos.some((s) => segmentos.includes(s)) && (!so || so.includes(c.id)))
    .sort((a, b) => (b.ultima ?? -Infinity) - (a.ultima ?? -Infinity));
}

export async function previa(segmentos: string[], agora = Date.now()) {
  return { elegiveis: (await elegiveis(segmentos, null, agora)).length };
}

export type DadosCampanha = { nome: string; segmentos: string[]; mensagem: string; limiteDiario: number; taxaRespostaBps: number; jogoId?: string | null };

async function dadosValidados(d: DadosCampanha) {
  const segmentos = [...new Set(d.segmentos)];
  if (!segmentos.length || segmentos.some((x) => !CHAVES_SEGMENTO.includes(x as Segmento))) throw new ErroNegocio("Escolha pelo menos um segmento.");
  if (d.jogoId) {
    if (!d.mensagem.includes("{link}")) throw new ErroNegocio("Coloque {link} na mensagem: é por ele que o cliente abre o jogo.");
    const jogo = await db.jogo.findUnique({ where: { id: d.jogoId } });
    if (!jogo || !noAr(jogo)) throw new ErroNegocio("Ligue o jogo (tela Jogos) antes de criar a campanha.", 409);
  }
  return { ...d, segmentos, jogoId: d.jogoId || null };
}

export async function criarCampanha(s: Sessao, d: DadosCampanha) {
  const dados = await dadosValidados(d);
  return db.$transaction(async (tx) => {
    const c = await tx.campanha.create({ data: { ...dados, criadoPorId: s.usuarioId } });
    await auditar(tx, s.usuarioId, "criar", "campanha", c.id, { nome: d.nome, segmentos: dados.segmentos, limiteDiario: d.limiteDiario, jogo: dados.jogoId });
    return c;
  });
}

/** IDs conhecidos permitem preparar a coleção em um clique e repetir sem sobrescrever edições. */
export async function prepararCampanhasPorSegmento(s: Sessao) {
  return db.$transaction(async tx => {
    const { count } = await tx.campanha.createMany({ skipDuplicates: true, data: MODELOS_SEGMENTOS.map(m => ({
      id: m.id, nome: m.nome, segmentos: [m.chave], mensagem: m.mensagem, limiteDiario: m.limiteDiario,
      taxaRespostaBps: m.taxaRespostaBps, status: "PAUSADA", criadoPorId: s.usuarioId,
    })) });
    if (count) await auditar(tx, s.usuarioId, "preparar_segmentos", "campanha", "segmentos-da-base", { criadas: count });
    return { criadas: count };
  });
}

export async function editarCampanha(s: Sessao, campanhaId: string, d: DadosCampanha) {
  const dados = await dadosValidados(d);
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`campanha:${campanhaId}`}))`;
    const c = await tx.campanha.findUnique({ where: { id: campanhaId } });
    if (!c) throw naoEncontrado("Campanha");
    if (c.status === "ENCERRADA") throw new ErroNegocio("Campanha encerrada.", 409);
    const modelo = MODELOS_SEGMENTOS.find(m => m.id === campanhaId);
    if (modelo && (dados.segmentos.length !== 1 || dados.segmentos[0] !== modelo.chave)) throw new ErroNegocio("O público desta campanha pertence ao card do segmento.", 409);
    if (await tx.campanhaEnvio.findFirst({ where: { campanhaId, status: "FILA" }, select: { id: true } })) {
      throw new ErroNegocio("Há um lote na fila. Aguarde o processamento antes de alterar a campanha.", 409);
    }
    if (c.jogoId !== dados.jogoId && await tx.campanhaEnvio.findFirst({ where: { campanhaId }, select: { id: true } })) {
      throw new ErroNegocio("Já há links desta campanha. Mantenha o jogo ou crie uma campanha nova.", 409);
    }
    const atualizada = await tx.campanha.update({ where: { id: campanhaId }, data: dados });
    await auditar(tx, s.usuarioId, "editar", "campanha", campanhaId, { nome: dados.nome, segmentos: dados.segmentos, limiteDiario: dados.limiteDiario, jogo: dados.jogoId });
    return atualizada;
  });
}

/** Libera o proximo lote: os `quantidade` primeiros elegiveis entram na fila da campanha. `clienteIds` limita (testes). */
export async function liberarLote(s: Sessao, campanhaId: string, quantidade: number, agora = Date.now(), opts: { clienteIds?: string[] } = {}) {
  const autorizado = await campanhasBloqueadas() ? await loteAutorizadoDisponivel() : null;
  if (!autorizado || autorizado.campanhaId !== campanhaId) await exigirCampanhaLiberada();
  const c = await db.campanha.findUnique({ where: { id: campanhaId } });
  if (!c) throw naoEncontrado("Campanha");
  if (c.status !== "ATIVA" && !(autorizado && c.status === "PAUSADA")) throw new ErroNegocio(c.status === "PAUSADA" ? "Retome a campanha antes de liberar outro lote." : "Campanha encerrada.", 409);
  if (autorizado && (!campanhaConferida(c, autorizado) || quantidade !== autorizado.clienteIds.length)) {
    throw new ErroNegocio("Use a mensagem e a quantidade do lote conferido.", 409);
  }
  const escolhidos = (await elegiveis(c.segmentos, c.id, agora, autorizado?.clienteIds ?? opts.clienteIds)).slice(0, quantidade);
  if (autorizado && escolhidos.length !== quantidade) {
    throw new ErroNegocio("A elegibilidade do público aprovado mudou ou o lote já foi liberado. Confira a lista antes de enviar.", 409);
  }
  if (!escolhidos.length) throw new ErroNegocio("Ninguém mais para chamar nesse segmento.", 409, "sem_elegiveis");
  return db.$transaction(async (tx) => {
    // Dois cliques ao mesmo tempo: um espera o outro (e o unique campanha+cliente nao deixa repetir).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`campanha:${campanhaId}`}))`;
    if (!autorizado) await exigirCampanhaLiberada();
    const atual = await tx.campanha.findUnique({ where: { id: campanhaId } });
    if (!atual || atual.status !== c.status || atual.segmentos.join(",") !== c.segmentos.join(",") || atual.mensagem !== c.mensagem ||
        atual.jogoId !== c.jogoId || atual.limiteDiario !== c.limiteDiario) {
      throw new ErroNegocio("A campanha mudou. Confira a versão atual antes de liberar o lote.", 409);
    }
    const lote = ((await tx.campanhaEnvio.aggregate({ where: { campanhaId }, _max: { lote: true } }))._max.lote ?? 0) + 1;
    if (autorizado) {
      if (lote !== 1) throw new ErroNegocio("O primeiro lote desta campanha já foi liberado.", 409);
      await tx.campanha.update({ where: { id: campanhaId }, data: { status: "ATIVA" } });
    }
    // Cada mensagem leva um link proprio (/c/r/<token>): e por ele que o funil sabe quem clicou.
    const r = await tx.campanhaEnvio.createMany({
      data: escolhidos.map((e) => ({ campanhaId, clienteId: e.id, lote, token: randomBytes(12).toString("base64url") })),
      skipDuplicates: !autorizado,
    });
    await auditar(tx, s.usuarioId, "liberar_lote", "campanha", campanhaId, {
      campanha: c.nome, lote, quantidade: r.count, ...(autorizado ? { autorizacao: identificadorDoLote(autorizado) } : {}),
    });
    return { lote, quantidade: r.count };
  });
}

export async function mudarStatus(s: Sessao, campanhaId: string, acao: "pausar" | "retomar" | "encerrar") {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`campanha:${campanhaId}`}))`;
    if (acao === "retomar") await exigirCampanhaLiberada();
    const c = await tx.campanha.findUnique({ where: { id: campanhaId } });
    if (!c) throw naoEncontrado("Campanha");
    if (c.status === "ENCERRADA") throw new ErroNegocio("Campanha encerrada.", 409);
    const status = acao === "pausar" ? "PAUSADA" : acao === "retomar" ? "ATIVA" : "ENCERRADA";
    await tx.campanha.update({ where: { id: campanhaId }, data: { status } });
    // Encerrada: quem ainda estava na fila nao recebe mais.
    if (status === "ENCERRADA") await tx.campanhaEnvio.updateMany({ where: { campanhaId, status: "FILA" }, data: { status: "PULADO", erro: "Campanha encerrada antes do envio." } });
    await auditar(tx, s.usuarioId, acao, "campanha", campanhaId, { campanha: c.nome, antes: { status: c.status }, depois: { status } });
  });
}

/** Campanhas com fila, enviados (hoje e no total), falhas, quem marcou depois de receber e quem pediu para parar. */
export async function listarCampanhas(agora = Date.now()) {
  const cfg = await configuracao();
  const inicioHoje = new Date(instanteLocal(dataLocal(agora, cfg.fuso), 0, cfg.fuso));
  const comJogo = { jogo: { select: { id: true, nome: true } } } as const;
  const [recentes, modelos, porStatus, confirmados, marcaram, autorizado] = await Promise.all([
    db.campanha.findMany({ orderBy: { criadoEm: "desc" }, take: 50, include: comJogo }),
    db.campanha.findMany({ where: { id: { in: MODELOS_SEGMENTOS.map(m => m.id) } }, include: comJogo }),
    db.campanhaEnvio.groupBy({ by: ["campanhaId", "status"], _count: { _all: true } }),
    resumoDosEnvios(inicioHoje, new Date(instanteLocal(somarDias(dataLocal(agora, cfg.fuso), 1), 0, cfg.fuso))),
    contagemDeClientesAtribuidos(),
    loteAutorizadoDisponivel(),
  ]);
  const cs = [...new Map([...recentes, ...modelos].map(c => [c.id, c])).values()];
  const b = await base(agora);
  const nomes = new Map((await db.usuario.findMany({ where: { id: { in: cs.map((c) => c.criadoPorId).filter((x): x is string => !!x) } }, select: { id: true, nome: true } })).map((u) => [u.id, u.nome]));
  const ids = new Map<string, Set<string>>();
  for (const e of await db.campanhaEnvio.findMany({ where: { campanhaId: { in: cs.map((c) => c.id) } }, select: { campanhaId: true, clienteId: true } })) {
    ids.set(e.campanhaId, (ids.get(e.campanhaId) ?? new Set()).add(e.clienteId));
  }
  const n = (xs: { campanhaId: string; n: number }[], id: string) => xs.find((x) => x.campanhaId === id)?.n ?? 0;
  return cs.map((c) => {
    const conta = (st: string) => porStatus.find((x) => x.campanhaId === c.id && x.status === st)?._count._all ?? 0;
    const ja = ids.get(c.id) ?? new Set();
    const envio = confirmados.find(e => e.campanhaId === c.id);
    return {
      id: c.id, nome: c.nome, segmentos: c.segmentos, mensagem: c.mensagem, limiteDiario: c.limiteDiario, taxaRespostaBps: c.taxaRespostaBps,
      status: c.status, jogo: c.jogo, criadoEm: c.criadoEm, criadoPor: c.criadoPorId ? nomes.get(c.criadoPorId) ?? null : null,
      fila: conta("FILA"), enviados: envio?.enviados ?? 0, falhas: conta("FALHOU"), pulados: conta("PULADO"),
      enviadosHoje: envio?.hoje ?? 0,
      marcaram: n(marcaram, c.id), pararam: envio?.recusam ?? 0,
      loteAutorizado: autorizado && c.status !== "ENCERRADA" && !ja.size && campanhaConferida(c, autorizado) ? autorizado.clienteIds.length : null,
      // Quem ainda da para chamar num proximo lote.
      elegiveis: b.filter((x) => podeReceber(x) && !ja.has(x.id) && x.segmentos.some((s) => c.segmentos.includes(s))).length,
    };
  });
}

/** Rotina (horario comercial): manda a fila das campanhas ativas, respeitando o limite diario de cada uma. */
export async function processarCampanhas(agora = Date.now(), opts: { clienteIds?: string[] } = {}) {
  const bloqueadas = await campanhasBloqueadas();
  const autorizado = bloqueadas ? await loteAutorizadoDisponivel() : null;
  if (bloqueadas && !autorizado) return 0;
  if (autorizado && !await loteAutorizadoConfirmado(autorizado)) return 0;
  const cfg = await configuracao();
  if (autorizado && !horarioComercial(agora, cfg.fuso)) return 0;
  const inicioHoje = new Date(instanteLocal(dataLocal(agora, cfg.fuso), 0, cfg.fuso));
  const clientes = autorizado ? autorizado.clienteIds.filter(id => !opts.clienteIds || opts.clienteIds.includes(id)) : opts.clienteIds;
  let total = 0;
  for (const c of await db.campanha.findMany({ where: { status: "ATIVA", id: autorizado?.campanhaId }, orderBy: { criadoEm: "asc" } })) {
    if (total >= MAX_POR_RODADA) break;
    if (autorizado && !campanhaConferida(c, autorizado)) continue;
    const hoje = await db.campanhaEnvio.count({ where: { campanhaId: c.id, enviadoEm: { gte: inicioHoje }, status: { in: ["ENVIADO", "FALHOU"] } } });
    const vez = Math.min(c.limiteDiario - hoje, MAX_POR_RODADA - total);
    if (vez <= 0) continue;
    const fila = await db.campanhaEnvio.findMany({
      where: { campanhaId: c.id, status: "FILA", lote: autorizado ? 1 : undefined, cliente: { enviosCampanha: { none: { status: "ENVIADO", enviadoEm: { gte: new Date(agora - INTERVALO_CAMPANHAS_MS) } } } }, ...(clientes ? { clienteId: { in: clientes } } : {}) },
      orderBy: [{ lote: "asc" }, { liberadoEm: "asc" }], take: vez,
      include: { cliente: { select: { nome: true, telefone: true, aceitaMensagens: true, excluidoEm: true, conversa: { select: { estado: true, recusaAutomaticas: true } } } } },
    });
    for (const e of fila) {
      const destino = await reservarContatoCampanha(e.id, c.id, e.clienteId, agora);
      if (!destino) continue;
      total++;
      try {
        const link = e.token ? `${urlSite()}/c/r/${e.token}` : `${urlSite()}/c/agendar`;
        const r = await notificarCliente(destino.telefone, montarMensagem(destino.mensagem, { nome: destino.nome, barbearia: cfg.nomeBarbearia, link }), {
          template: process.env.WHATSAPP_TEMPLATE_CAMPANHA?.trim(), envioAutorizadoId: autorizado ? e.id : undefined,
          campanha: true, pararSeHumano: true,
        });
        await db.campanhaEnvio.update({
          where: { id: e.id },
          data: { mensagemId: r.mensagemId, ...(r.erro ? { status: "FALHOU" as const, erro: r.erro.slice(0, 300) } : { enviadoEm: new Date(Date.now()) }) },
        });
      } catch (err) {
        await db.campanhaEnvio.update({ where: { id: e.id }, data: { status: "FALHOU", erro: (err as Error).message.slice(0, 300) } });
      }
    }
  }
  return total;
}
