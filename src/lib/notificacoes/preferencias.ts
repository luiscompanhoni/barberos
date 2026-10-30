import { z } from "zod";
import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import type { Sessao } from "@/lib/auth/sessao";
import { categoriaPermitida, PREFERENCIAS_PADRAO } from "./regras";
import type { PreferenciasNotificacoes } from "./tipos";

export const zPreferencias = z.object({ agenda: z.boolean(), avaliacoes: z.boolean(), recompra: z.boolean(), equipe: z.boolean() }).strict();
export async function preferenciasNotificacoes(usuarioId: string): Promise<PreferenciasNotificacoes> {
  const p = await db.notificacaoPreferencia.findUnique({ where: { usuarioId } });
  return p ? { agenda: p.agenda, avaliacoes: p.avaliacoes, recompra: p.recompra, equipe: p.equipe } : { ...PREFERENCIAS_PADRAO };
}
export async function salvarPreferenciasNotificacoes(s: Sessao, dados: PreferenciasNotificacoes) {
  return db.$transaction(async (tx) => {
    const anterior = await tx.notificacaoPreferencia.findUnique({ where: { usuarioId: s.usuarioId } });
    const p = await tx.notificacaoPreferencia.upsert({ where: { usuarioId: s.usuarioId }, create: { usuarioId: s.usuarioId, ...dados }, update: dados });
    const categorias = ["AGENDA", "AVALIACAO", "RECOMPRA", "EQUIPE"].filter((c) => !categoriaPermitida(c, p));
    await tx.pushEntrega.updateMany({ where: { estado: "PENDENTE", notificacao: { usuarioId: s.usuarioId, categoria: { in: categorias } } }, data: { estado: "CANCELADO", codigoErro: "PREFERENCIA_DESATIVADA" } });
    await auditar(tx, s.usuarioId, "preferencias_notificacoes", "usuario", s.usuarioId, { antes: anterior ? { agenda: anterior.agenda, avaliacoes: anterior.avaliacoes, recompra: anterior.recompra, equipe: anterior.equipe } : PREFERENCIAS_PADRAO, depois: dados });
    return { agenda: p.agenda, avaliacoes: p.avaliacoes, recompra: p.recompra, equipe: p.equipe };
  });
}
