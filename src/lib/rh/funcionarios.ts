/**
 * Ficha do funcionario (o cadastro e o mesmo do checklist: ChecklistPessoa).
 */
import { colunaParaData, dataParaColuna } from "@/lib/agenda/tempo";
import { auditar } from "@/lib/auditoria";
import type { Sessao } from "@/lib/auth/sessao";
import { totaisDePontos } from "@/lib/checklist/pontos";
import { progressoNivel } from "@/lib/checklist/regras";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";

export async function listarFuncionarios() {
  const [pessoas, barbeiros, cfg, totais] = await Promise.all([
    db.checklistPessoa.findMany({ orderBy: [{ ativo: "desc" }, { nome: "asc" }] }),
    db.barbeiro.findMany({ where: { ativo: true }, orderBy: [{ ordem: "asc" }, { nome: "asc" }], select: { id: true, nome: true } }),
    db.checklistConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} }),
    totaisDePontos(),
  ]);
  return {
    barbeiros,
    funcionarios: pessoas.map((p) => {
      const pontos = totais.get(p.id) ?? 0;
      return {
        id: p.id, nome: p.nome, telefone: p.telefone, funcao: p.funcao, ativo: p.ativo,
        cargo: p.cargo, salarioCentavos: p.salarioCentavos, chavePix: p.chavePix,
        admissao: p.admissao ? colunaParaData(p.admissao) : null, barbeiroId: p.barbeiroId,
        pontos, nivel: progressoNivel(pontos, cfg).nivel,
      };
    }),
  };
}

export type FichaEntrada = { cargo: string | null; salarioCentavos: number; chavePix: string | null; admissao: string | null; barbeiroId: string | null };

export async function salvarFicha(s: Sessao, id: string, d: FichaEntrada) {
  const p = await db.checklistPessoa.findUnique({ where: { id } });
  if (!p) throw naoEncontrado("Funcionário");
  if (d.barbeiroId) {
    const outro = await db.checklistPessoa.findFirst({ where: { barbeiroId: d.barbeiroId, id: { not: id } }, select: { nome: true } });
    if (outro) throw new ErroNegocio(`Esse barbeiro da agenda já está ligado a ${outro.nome}.`, 409, "barbeiro_em_uso");
  }
  await db.$transaction(async (tx) => {
    await tx.checklistPessoa.update({
      where: { id },
      data: { cargo: d.cargo || null, salarioCentavos: d.salarioCentavos, chavePix: d.chavePix || null, admissao: d.admissao ? dataParaColuna(d.admissao) : null, barbeiroId: d.barbeiroId || null },
    });
    // Nao grava a chave Pix na auditoria.
    await auditar(tx, s.usuarioId, "rh_ficha", "checklist_pessoa", id, { cargo: d.cargo, salarioCentavos: d.salarioCentavos, admissao: d.admissao, barbeiroId: d.barbeiroId, salarioAntes: p.salarioCentavos });
  });
}
