import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal } from "@/lib/agenda/tempo";
import { lembreteDevido } from "@/lib/automacoes/regras";
import { configRecompras } from "@/lib/recompras/configuracao";
import { ciclosDoCliente } from "@/lib/recompras/rotina";
import { dadosAgenda, dadosAvaliacao, dadosEquipe, dadosRecompra, mesmosCiclos } from "./geracao-regras";
import { resumoEquipeProprio } from "./geracao-equipe";

export type AvisoRevalidavel = { usuarioId: string; categoria: string; dados: Prisma.JsonValue; expiraEm: Date };
type CacheRelevancia = Map<string, Promise<unknown>>;
function umaVez<T>(cache: CacheRelevancia | undefined, chave: string, ler: () => Promise<T>): Promise<T> {
  if (!cache) return ler();
  const anterior = cache.get(chave);
  if (anterior) return anterior as Promise<T>;
  const consulta = ler();
  cache.set(chave, consulta);
  return consulta;
}
/** Cache limitado a uma leitura da central, sem compartilhar identidades entre requisições. */
export function criarVerificadorRelevancia(agora = new Date()) {
  const cache: CacheRelevancia = new Map();
  return (n: AvisoRevalidavel) => notificacaoAindaRelevante(n, agora, cache);
}

/** Revalida também leitura da central: cancelamento, troca de vínculo e mudança de preferência não vazam avisos antigos. */
export async function notificacaoAindaRelevante(n: AvisoRevalidavel, agora = new Date(), cache?: CacheRelevancia): Promise<boolean> {
  if (n.expiraEm <= agora) return false;
  const usuario = await umaVez(cache, `usuario:${n.usuarioId}`, () => db.usuario.findFirst({ where: { id: n.usuarioId, ativo: true }, select: { papel: true, notificacaoPreferencia: true } }));
  if (!usuario) return false;
  const pref = usuario.notificacaoPreferencia;
  if (n.categoria === "TESTE") return true;
  if (n.categoria === "AGENDA") {
    if (usuario.papel !== "CLIENTE" || pref?.agenda === false) return false;
    const d = dadosAgenda.safeParse(n.dados);
    if (!d.success) return false;
    const [cfg, a] = await Promise.all([
      umaVez(cache, "config", configuracao), db.agendamento.findFirst({ where: { id: d.data.agendamentoId, adicionalDeId: null, cliente: { usuarioId: n.usuarioId } }, select: { inicio: true, criadoEm: true, status: true } }),
    ]);
    return !!a && a.inicio.toISOString() === d.data.inicio && lembreteDevido({ inicio: +a.inicio, criadoEm: +a.criadoEm, status: a.status }, +agora, cfg) === d.data.tipo;
  }
  if (n.categoria === "AVALIACAO") {
    if (usuario.papel !== "CLIENTE" || pref?.avaliacoes === false) return false;
    const d = dadosAvaliacao.safeParse(n.dados);
    if (!d.success) return false;
    const [cfg, convite] = await Promise.all([
      umaVez(cache, "avaliacao-config", () => db.avaliacaoConfig.findUnique({ where: { id: 1 } })),
      db.conviteAvaliacao.findFirst({ where: { id: d.data.conviteId, respondidaEm: null, resposta: null, expiraEm: { gt: agora }, cliente: { usuarioId: n.usuarioId }, agendamento: { status: "CONCLUIDO", fim: { lte: agora } } }, select: { agendamento: { select: { fim: true } } } }),
    ]);
    return !!cfg?.ativo && !!cfg.ativaDesde && !!convite && convite.agendamento.fim >= cfg.ativaDesde;
  }
  if (n.categoria === "RECOMPRA") {
    if (usuario.papel !== "CLIENTE" || pref?.recompra !== true) return false;
    const d = dadosRecompra.safeParse(n.dados);
    if (!d.success) return false;
    const [cfg, politica, cliente] = await Promise.all([
      umaVez(cache, "config", configuracao), umaVez(cache, "recompra-config", configRecompras), db.cliente.findFirst({ where: { id: d.data.clienteId, usuarioId: n.usuarioId }, select: { id: true } }),
    ]);
    if (!politica.ativo || !cliente) return false;
    return mesmosCiclos(d.data.ciclos, await umaVez(cache, `ciclos:${cliente.id}`, () => ciclosDoCliente(cliente.id, +agora, cfg.fuso)));
  }
  if (n.categoria === "EQUIPE") {
    if (usuario.papel === "CLIENTE" || pref?.equipe === false) return false;
    const d = dadosEquipe.safeParse(n.dados);
    if (!d.success) return false;
    const cfg = await umaVez(cache, "config", configuracao);
    if (d.data.data !== dataLocal(agora, cfg.fuso)) return false;
    return !!await umaVez(cache, `equipe:${n.usuarioId}:${d.data.barbeiroId}:${d.data.data}`, () => resumoEquipeProprio(d.data.barbeiroId, n.usuarioId, d.data.data, agora, cfg));
  }
  return false;
}
