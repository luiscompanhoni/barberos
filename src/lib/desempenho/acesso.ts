import type { Prisma } from "@prisma/client";
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal } from "@/lib/agenda/tempo";
import { exigirPermissao, pode } from "@/lib/auth/permissoes";
import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado, proibido } from "@/lib/erros";

export async function contexto(s: Sessao) {
  const [cfg, propria, avaliar] = await Promise.all([
    configuracao(), db.checklistPessoa.findUnique({ where: { usuarioId: s.usuarioId }, select: { id: true } }), pode(s, "avaliar_equipe"),
  ]);
  return { fuso: cfg.fuso, hoje: dataLocal(Date.now(), cfg.fuso), propriaId: propria?.id ?? null, avaliar, dono: s.papel === "DONO" };
}

export async function exigirPessoa(s: Sessao, pessoaId: string, opts: { propria?: boolean; avaliar?: boolean } = {}) {
  const pessoa = await db.checklistPessoa.findUnique({ where: { id: pessoaId }, include: { barbeiro: { select: { usuarioId: true } } } });
  if (!pessoa) throw naoEncontrado("Pessoa");
  const propria = pessoa.usuarioId === s.usuarioId || pessoa.barbeiro?.usuarioId === s.usuarioId;
  if (opts.propria && !propria) throw proibido();
  if (opts.avaliar) {
    await exigirPermissao(s, "avaliar_equipe");
    if (propria) throw new ErroNegocio("Outra pessoa da liderança deve revisar seu próprio desempenho.", 403);
  } else if (!propria) await exigirPermissao(s, "avaliar_equipe");
  return { pessoa, propria };
}

export function exigirDono(s: Sessao) {
  if (s.papel !== "DONO") throw proibido();
}

/** Compartilha a trava com o fechamento da folha, preservando a memória de cálculo. */
export async function travarCompetencia(tx: Prisma.TransactionClient, pessoaId: string, competencia: string) {
  await tx.$queryRaw`SELECT id FROM checklist_pessoas WHERE id = ${pessoaId} FOR UPDATE`;
  const [bonus, folha] = await Promise.all([
    tx.desempenhoBonus.findUnique({ where: { pessoaId_competencia: { pessoaId, competencia } } }),
    tx.folhaPagamento.findUnique({ where: { competencia_pessoaId: { competencia, pessoaId } } }),
  ]);
  if (bonus || folha) throw new ErroNegocio("O desempenho ou a folha desta competência já foi fechado. O histórico não pode ser alterado.", 409, "competencia_fechada");
}
