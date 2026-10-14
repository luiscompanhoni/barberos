/**
 * Campanhas no WhatsApp por segmento da base: o dono (ou gerente) libera lotes do tamanho que a agenda aguenta e a
 * rotina das automacoes manda aos poucos, no horario comercial, sem passar do limite diario da campanha.
 */
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal, instanteLocal } from "@/lib/agenda/tempo";
import { auditar } from "@/lib/auditoria";
import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { urlSite } from "@/lib/dominios";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { notificarCliente } from "@/lib/whatsapp/conversas";
import { CHAVES_SEGMENTO, montarMensagem, segmentosDoCliente, SEGMENTOS, type Segmento } from "./regras";

/** Quantas mensagens de campanha saem por rodada da rotina (a cada 5 min), somando todas: espalha o envio. */
const MAX_POR_RODADA = 20;
/** Marcou ate X dias depois de receber = conta como resultado da campanha. */
const JANELA_RESULTADO_DIAS = 14;

type ClienteBase = { id: string; aceitaMensagens: boolean; temFuturo: boolean; ultima: number | null; segmentos: Segmento[] };

/** Cada cliente com os segmentos em que esta, se aceita mensagens e se ja tem horario marcado. */
async function base(agora: number): Promise<ClienteBase[]> {
  const [clientes, visitas, assinaturas, futuros] = await Promise.all([
    db.cliente.findMany({ select: { id: true, aceitaMensagens: true } }),
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
    return { id: c.id, aceitaMensagens: c.aceitaMensagens, temFuturo: comFuturo.has(c.id), ultima, segmentos: segmentosDoCliente({ ultima, primeira, assinatura: plano.get(c.id) ?? null }, agora) };
  });
}

const podeReceber = (c: ClienteBase) => c.aceitaMensagens && !c.temFuturo;

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

export type DadosCampanha = { nome: string; segmentos: string[]; mensagem: string; limiteDiario: number; taxaRespostaBps: number };

export async function criarCampanha(s: Sessao, d: DadosCampanha) {
  const segmentos = [...new Set(d.segmentos)];
  if (!segmentos.length || segmentos.some((x) => !CHAVES_SEGMENTO.includes(x as Segmento))) throw new ErroNegocio("Escolha pelo menos um segmento.");
  return db.$transaction(async (tx) => {
    const c = await tx.campanha.create({ data: { ...d, segmentos, criadoPorId: s.usuarioId } });
    await auditar(tx, s.usuarioId, "criar", "campanha", c.id, { nome: d.nome, segmentos, limiteDiario: d.limiteDiario });
    return c;
  });
}

/** Libera o proximo lote: os `quantidade` primeiros elegiveis entram na fila da campanha. `clienteIds` limita (testes). */
export async function liberarLote(s: Sessao, campanhaId: string, quantidade: number, agora = Date.now(), opts: { clienteIds?: string[] } = {}) {
  const c = await db.campanha.findUnique({ where: { id: campanhaId } });
  if (!c) throw naoEncontrado("Campanha");
  if (c.status !== "ATIVA") throw new ErroNegocio(c.status === "PAUSADA" ? "Retome a campanha antes de liberar outro lote." : "Campanha encerrada.", 409);
  const escolhidos = (await elegiveis(c.segmentos, c.id, agora, opts.clienteIds)).slice(0, quantidade);
  if (!escolhidos.length) throw new ErroNegocio("Ninguém mais para chamar nesse segmento.", 409, "sem_elegiveis");
  return db.$transaction(async (tx) => {
    // Dois cliques ao mesmo tempo: um espera o outro (e o unique campanha+cliente nao deixa repetir).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`campanha:${campanhaId}`}))`;
    const lote = ((await tx.campanhaEnvio.aggregate({ where: { campanhaId }, _max: { lote: true } }))._max.lote ?? 0) + 1;
    const r = await tx.campanhaEnvio.createMany({ data: escolhidos.map((e) => ({ campanhaId, clienteId: e.id, lote })), skipDuplicates: true });
    await auditar(tx, s.usuarioId, "liberar_lote", "campanha", campanhaId, { campanha: c.nome, lote, quantidade: r.count });
    return { lote, quantidade: r.count };
  });
}

export async function mudarStatus(s: Sessao, campanhaId: string, acao: "pausar" | "retomar" | "encerrar") {
  await db.$transaction(async (tx) => {
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
  const [cs, porStatus, hoje, marcaram, pararam] = await Promise.all([
    db.campanha.findMany({ orderBy: { criadoEm: "desc" }, take: 50 }),
    db.campanhaEnvio.groupBy({ by: ["campanhaId", "status"], _count: { _all: true } }),
    db.campanhaEnvio.groupBy({ by: ["campanhaId"], where: { enviadoEm: { gte: inicioHoje }, status: { in: ["ENVIADO", "FALHOU"] } }, _count: { _all: true } }),
    db.$queryRaw<{ campanhaId: string; n: number }[]>`
      SELECT e."campanhaId", COUNT(DISTINCT e."clienteId")::int AS n
      FROM campanha_envios e JOIN agendamentos a ON a."clienteId" = e."clienteId"
      WHERE e.status = 'ENVIADO' AND a."criadoEm" > e."enviadoEm" AND a."criadoEm" <= e."enviadoEm" + make_interval(days => ${JANELA_RESULTADO_DIAS}::int)
      GROUP BY 1`,
    db.$queryRaw<{ campanhaId: string; n: number }[]>`
      SELECT e."campanhaId", COUNT(*)::int AS n FROM campanha_envios e JOIN clientes c ON c.id = e."clienteId"
      WHERE e.status = 'ENVIADO' AND c."aceitaMensagens" = false GROUP BY 1`,
  ]);
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
    const enviados = conta("ENVIADO");
    return {
      id: c.id, nome: c.nome, segmentos: c.segmentos, mensagem: c.mensagem, limiteDiario: c.limiteDiario, taxaRespostaBps: c.taxaRespostaBps,
      status: c.status, criadoEm: c.criadoEm, criadoPor: c.criadoPorId ? nomes.get(c.criadoPorId) ?? null : null,
      fila: conta("FILA"), enviados, falhas: conta("FALHOU"), pulados: conta("PULADO"),
      enviadosHoje: hoje.find((x) => x.campanhaId === c.id)?._count._all ?? 0,
      marcaram: n(marcaram, c.id), pararam: n(pararam, c.id),
      // Quem ainda da para chamar num proximo lote.
      elegiveis: b.filter((x) => podeReceber(x) && !ja.has(x.id) && x.segmentos.some((s) => c.segmentos.includes(s))).length,
    };
  });
}

/** Rotina (horario comercial): manda a fila das campanhas ativas, respeitando o limite diario de cada uma. */
export async function processarCampanhas(agora = Date.now(), opts: { clienteIds?: string[] } = {}) {
  const cfg = await configuracao();
  const inicioHoje = new Date(instanteLocal(dataLocal(agora, cfg.fuso), 0, cfg.fuso));
  const link = `${urlSite()}/c/agendar`;
  let total = 0;
  for (const c of await db.campanha.findMany({ where: { status: "ATIVA" }, orderBy: { criadoEm: "asc" } })) {
    if (total >= MAX_POR_RODADA) break;
    const hoje = await db.campanhaEnvio.count({ where: { campanhaId: c.id, enviadoEm: { gte: inicioHoje }, status: { in: ["ENVIADO", "FALHOU"] } } });
    const vez = Math.min(c.limiteDiario - hoje, MAX_POR_RODADA - total);
    if (vez <= 0) continue;
    const fila = await db.campanhaEnvio.findMany({
      where: { campanhaId: c.id, status: "FILA", ...(opts.clienteIds ? { clienteId: { in: opts.clienteIds } } : {}) },
      orderBy: [{ lote: "asc" }, { liberadoEm: "asc" }], take: vez,
      include: { cliente: { select: { nome: true, telefone: true, aceitaMensagens: true } } },
    });
    for (const e of fila) {
      // Pode ter mudado desde que o lote foi liberado.
      const marcou = await db.agendamento.count({ where: { clienteId: e.clienteId, status: { in: ["MARCADO", "CONFIRMADO"] }, inicio: { gt: new Date(agora) } } });
      const pular = !e.cliente.aceitaMensagens ? "Pediu para não receber mensagens." : marcou ? "Já tem horário marcado." : null;
      // Reserva a linha antes de mandar: duas rodadas ao mesmo tempo nao mandam duas vezes.
      const ok = await db.campanhaEnvio.updateMany({
        where: { id: e.id, status: "FILA" },
        data: pular ? { status: "PULADO", erro: pular } : { status: "ENVIADO", enviadoEm: new Date(agora) },
      });
      if (!ok.count || pular) continue;
      total++;
      try {
        const r = await notificarCliente(e.cliente.telefone, montarMensagem(c.mensagem, { nome: e.cliente.nome, barbearia: cfg.nomeBarbearia, link }));
        const erro = r && typeof r === "object" && "erro" in r ? (r.erro as string | null) : null;
        if (erro) await db.campanhaEnvio.update({ where: { id: e.id }, data: { status: "FALHOU", erro: erro.slice(0, 300) } });
      } catch (err) {
        await db.campanhaEnvio.update({ where: { id: e.id }, data: { status: "FALHOU", erro: (err as Error).message.slice(0, 300) } });
      }
    }
  }
  return total;
}

export const DIAS_RESULTADO = JANELA_RESULTADO_DIAS;
