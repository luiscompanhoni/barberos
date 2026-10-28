import { auditar } from "@/lib/auditoria";
import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio } from "@/lib/erros";
import { exigirDono, exigirPessoa } from "./acesso";
import { jsonSeguro } from "./configuracao";
import { resumoPessoa } from "./consultas";

/** Aprovação mensal única, junto ao lançamento e pontos; não paga nem altera comissão. */
export async function aprovarBonus(s: Sessao, pessoaId: string, competencia: string) {
  exigirDono(s);
  await exigirPessoa(s, pessoaId);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM checklist_pessoas WHERE id = ${pessoaId} FOR UPDATE`;
    const anterior = await tx.desempenhoBonus.findUnique({ where: { pessoaId_competencia: { pessoaId, competencia } } });
    if (anterior) return { id: anterior.id, jaAprovado: true };
    if (await tx.folhaPagamento.findUnique({ where: { competencia_pessoaId: { competencia, pessoaId } } })) throw new ErroNegocio("A folha já foi fechada. Nenhum bônus será acrescentado ao histórico fechado.", 409);
    const r = await resumoPessoa(pessoaId, competencia, tx);
    if (!r.regraId || !r.resultado.elegivel) throw new ErroNegocio("O bônus ainda não está elegível. Confira os critérios e pendências.", 409, "bonus_pendente", { pendencias: r.resultado.pendencias, criterios: r.resultado.criterios });
    if (!r.resultado.bonusCentavos && !r.resultado.pontos) throw new ErroNegocio("A faixa não tem bônus ou pontos configurados.");
    const folha = r.resultado.bonusCentavos > 0 ? await tx.folhaLancamento.create({ data: { pessoaId, competencia, tipo: "BONUS", valorCentavos: r.resultado.bonusCentavos, descricao: `Desempenho ${competencia} · BLACK ${r.nivel}`, porId: s.usuarioId } }) : null;
    const pontos = r.resultado.pontos > 0 ? await tx.checklistPonto.create({ data: { pessoaId, pontos: r.resultado.pontos, descricao: `Desempenho ${competencia}: presença ${r.programa.pontosPresenca}, liderança ${r.programa.faixas[r.nivel].liderMin !== null ? r.programa.pontosLider : 0}, clientes ${r.programa.faixas[r.nivel].clientesMin !== null ? r.programa.pontosClientes : 0}`, porNome: s.nome } }) : null;
    const snapshot = jsonSeguro({ competencia, regra: r.programa, nivel: r.nivel, pontosAnteriores: r.pontos, presenca: r.presenca, checklist: r.checklist, lider: r.lider, clientes: r.clientes, resultado: r.resultado });
    const bonus = await tx.desempenhoBonus.create({ data: { pessoaId, competencia, regraId: r.regraId, valorCentavos: r.resultado.bonusCentavos, snapshot, folhaLancamentoId: folha?.id, checklistPontoId: pontos?.id, porId: s.usuarioId } });
    await auditar(tx, s.usuarioId, "desempenho_bonus_aprovar", "desempenho_bonus", bonus.id, { pessoaId, competencia, valorCentavos: bonus.valorCentavos, pontos: r.resultado.pontos, regraId: r.regraId });
    return { id: bonus.id, jaAprovado: false };
  }, { timeout: 15_000 });
}
