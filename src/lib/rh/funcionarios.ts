/**
 * Ficha do funcionario (o cadastro e o mesmo do checklist: ChecklistPessoa).
 */
import { colunaParaData, dataParaColuna } from "@/lib/agenda/tempo";
import { auditarMudanca } from "@/lib/auditoria";
import type { Sessao } from "@/lib/auth/sessao";
import { totaisDePontos } from "@/lib/checklist/pontos";
import { progressoNivel } from "@/lib/checklist/regras";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { protegerChavePix, resumoPix } from "./pix-protegido";
import { competenciaSalario, competenciasRemuneracao, garantirBaselineRemuneracao, gravarVigenciaRemuneracao, lerVigenciaRemuneracao } from "./vigencias";
import { z } from "zod";
const zSalario = z.object({ salarioCentavos: z.number().int().min(0).max(100_000_000) });

export async function listarFuncionarios() {
  const [pessoas, barbeiros, cfg, totais] = await Promise.all([
    db.checklistPessoa.findMany({ orderBy: [{ ativo: "desc" }, { nome: "asc" }] }),
    db.barbeiro.findMany({ where: { ativo: true }, orderBy: [{ ordem: "asc" }, { nome: "asc" }], select: { id: true, nome: true } }),
    db.checklistConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} }),
    totaisDePontos(),
  ]);
  const competencias = competenciasRemuneracao();
  const salariosAtuais = await Promise.all(pessoas.map(async p => {
    const versao = await lerVigenciaRemuneracao(db, `salario:${p.id}`, competencias.atual);
    const validado = zSalario.safeParse(versao?.conteudo ?? { salarioCentavos: p.salarioCentavos });
    if (!validado.success) throw new ErroNegocio("Histórico salarial inválido. Confira as versões antes de usar este valor.", 409, "remuneracao_invalida");
    return { salarioCentavos: validado.data.salarioCentavos, homologado: versao?.origem === "CONFIGURACAO_EXPLICITA" };
  }));
  return {
    barbeiros, competenciaAtual: competencias.atual, competenciaSalarioPadrao: competencias.proxima,
    funcionarios: pessoas.map((p, i) => {
      const pontos = totais.get(p.id) ?? 0;
      return {
        id: p.id, nome: p.nome, telefone: p.telefone, funcao: p.funcao, ativo: p.ativo,
        cargo: p.cargo, salarioCentavos: p.salarioCentavos, pix: resumoPix(p), revisaoPix: p.revisaoPix,
        salarioAtualCentavos: salariosAtuais[i].salarioCentavos,
        salarioHomologado: salariosAtuais[i].homologado,
        admissao: p.admissao ? colunaParaData(p.admissao) : null, barbeiroId: p.barbeiroId,
        pontos, nivel: progressoNivel(pontos, cfg).nivel,
      };
    }),
  };
}

export type FichaEntrada = { cargo: string | null; salarioCentavos: number; competenciaSalario?: string; chavePix?: string | null; revisaoPix?: number; admissao: string | null; barbeiroId: string | null };

export async function salvarFicha(s: Sessao, id: string, d: FichaEntrada) {
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM checklist_pessoas WHERE id = ${id} FOR UPDATE`;
    const p = await tx.checklistPessoa.findUnique({ where: { id } });
    if (!p) throw naoEncontrado("Funcionário");
    if (d.barbeiroId) {
      const outro = await tx.checklistPessoa.findFirst({ where: { barbeiroId: d.barbeiroId, id: { not: id } }, select: { nome: true } });
      if (outro) throw new ErroNegocio(`Esse barbeiro da agenda já está ligado a ${outro.nome}.`, 409, "barbeiro_em_uso");
    }
    let pix = {};
    if (d.chavePix !== undefined) {
      const ator = await tx.usuario.findUnique({ where: { id: s.usuarioId } });
      if (!ator?.ativo || ator.papel !== "DONO" || (ator.sessaoVersao ?? 0) !== (s.sessaoVersao ?? 0)) throw new ErroNegocio("Somente o dono pode alterar destinatários Pix.", 403);
      if (d.revisaoPix === undefined || d.revisaoPix !== p.revisaoPix) throw new ErroNegocio("O cadastro Pix mudou. Atualize a ficha antes de alterar a chave.", 409, "pix_mudou");
      pix = protegerChavePix(id, d.chavePix);
    }
    let vigencia: string | undefined;
    if (p.salarioCentavos !== d.salarioCentavos || d.competenciaSalario !== undefined) {
      vigencia = competenciaSalario(d.competenciaSalario);
      if (await tx.folhaPagamento.count({ where: { pessoaId: id, competencia: vigencia, ativa: true, status: { in: ["FECHADA", "PAGA"] } } })) {
        throw new ErroNegocio("Essa competência já tem folha fechada. Escolha uma competência posterior.", 409, "folha_fechada");
      }
      await garantirBaselineRemuneracao(tx, `salario:${id}`, { salarioCentavos: p.salarioCentavos }, s.usuarioId);
      await gravarVigenciaRemuneracao(tx, { escopo: `salario:${id}`, competencia: vigencia, conteudo: { salarioCentavos: d.salarioCentavos }, atorId: s.usuarioId });
    }
    const novo = await tx.checklistPessoa.update({
      where: { id },
      data: { cargo: d.cargo || null, salarioCentavos: d.salarioCentavos, ...pix, admissao: d.admissao ? dataParaColuna(d.admissao) : null, barbeiroId: d.barbeiroId || null },
      select: { revisaoPix: true },
    });
    // Nao grava a chave Pix na auditoria (so se mudou).
    await auditarMudanca(tx, s.usuarioId, "rh_ficha", "checklist_pessoa", id,
      { cargo: p.cargo, salarioCentavos: p.salarioCentavos, admissao: p.admissao, barbeiroId: p.barbeiroId, revisaoPix: p.revisaoPix },
      { cargo: d.cargo || null, salarioCentavos: d.salarioCentavos, admissao: d.admissao ? dataParaColuna(d.admissao) : null, barbeiroId: d.barbeiroId || null, revisaoPix: novo.revisaoPix },
      { funcionario: p.nome, ...(vigencia ? { competenciaSalario: vigencia } : {}) });
  });
}
