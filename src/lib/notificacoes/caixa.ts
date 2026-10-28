import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { Sessao } from "@/lib/auth/sessao";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { configuracaoPush, configuracaoPushPublica } from "./configuracao";
import { dispositivosDoUsuario } from "./inscricoes";
import { preferenciasNotificacoes } from "./preferencias";
import { categoriaPermitida, hrefNotificacaoValido, PREFERENCIAS_PADRAO } from "./regras";
import { criarVerificadorRelevancia } from "./geracao-relevancia";
import type { CategoriaNotificacao, NotificacaoDto, PainelNotificacoes } from "./tipos";

type Tx = Prisma.TransactionClient;
export type NovaNotificacao = {
  usuarioId: string; categoria: CategoriaNotificacao; chave: string; titulo: string; corpo: string;
  href: string; expiraEm?: Date; criadoEm?: Date; dados?: Prisma.InputJsonValue;
};

/** O evento e a fila por aparelho nascem na mesma transação, sem envio externo. */
export async function publicarNotificacao(d: NovaNotificacao, tx?: Tx, opts: { inscricaoIds?: string[] } = {}): Promise<{ id: string; criada: boolean } | null> {
  const criadoEm = d.criadoEm ?? new Date();
  const expiraEm = d.expiraEm ?? new Date(+criadoEm + 24 * 60 * 60_000);
  if (!d.chave || d.chave.length > 240 || !d.titulo.trim() || d.titulo.length > 120 || d.corpo.length > 600 || !hrefNotificacaoValido(d.href) || !Number.isFinite(+expiraEm) || expiraEm <= criadoEm || +expiraEm - +criadoEm > 90 * 24 * 60 * 60_000) throw new ErroNegocio("Dados do aviso inválidos.", 400);
  const executar = async (t: Tx) => {
    const usuario = await t.usuario.findUnique({ where: { id: d.usuarioId }, select: { ativo: true, notificacaoPreferencia: true } });
    if (!usuario?.ativo || !categoriaPermitida(d.categoria, usuario.notificacaoPreferencia ?? PREFERENCIAS_PADRAO)) return null;
    await t.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`notificacao:${d.usuarioId}:${d.chave}`}))`;
    const existente = await t.notificacao.findUnique({ where: { usuarioId_chave: { usuarioId: d.usuarioId, chave: d.chave } }, select: { id: true } });
    if (existente) return { id: existente.id, criada: false };
    const n = await t.notificacao.create({ data: { ...d, criadoEm, expiraEm, dados: d.dados ?? {} } });
    const cfg = configuracaoPush();
    if (cfg.disponivel) {
      const aparelhos = await t.pushInscricao.findMany({ where: { usuarioId: d.usuarioId, ativo: true, vapidHash: cfg.vapidHash, ...(opts.inscricaoIds ? { id: { in: opts.inscricaoIds } } : {}) }, select: { id: true } });
      if (aparelhos.length) await t.pushEntrega.createMany({ data: aparelhos.map((a) => ({ notificacaoId: n.id, inscricaoId: a.id })), skipDuplicates: true });
    }
    return { id: n.id, criada: true };
  };
  return tx ? executar(tx) : db.$transaction(executar);
}

export async function caixaNotificacoes(s: Sessao, token?: string | null): Promise<PainelNotificacoes> {
  const agora = new Date();
  const [notificacoes, preferencias, dispositivos] = await Promise.all([
    db.notificacao.findMany({ where: { usuarioId: s.usuarioId, expiraEm: { gt: agora } }, orderBy: [{ criadoEm: "desc" }, { id: "desc" }], take: 100 }),
    preferenciasNotificacoes(s.usuarioId), dispositivosDoUsuario(s.usuarioId, token),
  ]);
  const verificar = criarVerificadorRelevancia(agora);
  const validade = await Promise.all(notificacoes.map((n) => categoriaPermitida(n.categoria, preferencias) ? verificar(n) : false));
  const itens = notificacoes.filter((_, i) => validade[i]).map((n): NotificacaoDto => ({ id: n.id, categoria: n.categoria as CategoriaNotificacao, titulo: n.titulo, corpo: n.corpo, href: n.href, criadoEm: n.criadoEm.toISOString(), expiraEm: n.expiraEm.toISOString(), lidaEm: n.lidaEm?.toISOString() ?? null }));
  return { usuarioId: s.usuarioId, itens, naoLidas: itens.filter((n) => !n.lidaEm).length, preferencias, dispositivos, push: configuracaoPushPublica() };
}

export async function marcarNotificacaoLida(s: Sessao, id: string) {
  const n = await db.notificacao.findFirst({ where: { id, usuarioId: s.usuarioId }, select: { id: true, lidaEm: true } });
  if (!n) throw naoEncontrado("Aviso");
  if (!n.lidaEm) await db.notificacao.updateMany({ where: { id, usuarioId: s.usuarioId, lidaEm: null }, data: { lidaEm: new Date() } });
  return { ok: true };
}
