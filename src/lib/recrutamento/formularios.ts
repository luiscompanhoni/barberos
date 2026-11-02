import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { ErroNegocio, naoEncontrado, proibido } from "@/lib/erros";
import { calcularAvaliacao, zAvaliacao, zDefinicao, zFormulario } from "./formularios-regras";
export async function exigirGestaoRecrutamento(tx: Prisma.TransactionClient, usuarioId: string) {
  const u = await tx.usuario.findFirst({ where: { id: usuarioId, ativo: true, papel: { in: ["DONO", "GERENTE"] } } });
  if (!u) throw proibido(); return u;
}
export async function criarFormulario(usuarioId: string, entrada: z.infer<typeof zFormulario>, origemId?: string) {
  const b = zFormulario.parse(entrada);
  return db.$transaction(async tx => {
    await exigirGestaoRecrutamento(tx, usuarioId);
    if (origemId && !await tx.formularioRecrutamento.findUnique({ where: { id: origemId } })) throw naoEncontrado("Formulário de origem");
    const f = await tx.formularioRecrutamento.create({ data: { ...b, definicao: b.definicao as Prisma.InputJsonValue, origemId, criadoPorId: usuarioId } });
    await auditar(tx, usuarioId, "recrutamento.formulario.criado", "FormularioRecrutamento", f.id, { origemId: origemId ?? null }); return f;
  });
}
export async function alterarFormulario(usuarioId: string, id: string, revisao: number, entrada: z.infer<typeof zFormulario> | "APROVAR" | "ARQUIVAR") {
  return db.$transaction(async tx => {
    await exigirGestaoRecrutamento(tx, usuarioId);
    const f = await tx.formularioRecrutamento.findUnique({ where: { id } }); if (!f) throw naoEncontrado("Formulário");
    if (f.revisao !== revisao) throw new ErroNegocio("Formulário alterado por outra pessoa. Recarregue antes de continuar.", 409);
    if (entrada !== "ARQUIVAR" && f.estado !== "RASCUNHO") throw new ErroNegocio("Duplique a versão aprovada para editar.", 409);
    if (entrada === "ARQUIVAR" && await tx.vagaRecrutamento.count({ where: { formularioId: id, ativa: true } })) throw new ErroNegocio("Encerre as inscrições antes de arquivar este formulário.", 409);
    if (entrada === "APROVAR") zDefinicao.parse(f.definicao);
    const b = typeof entrada === "string" ? null : zFormulario.parse(entrada);
    const dados = b ? { ...b, definicao: b.definicao as Prisma.InputJsonValue } : entrada === "APROVAR" ? { estado: "APROVADO", aprovadoPorId: usuarioId, aprovadoEm: new Date() } : { estado: "ARQUIVADO" };
    const r = await tx.formularioRecrutamento.updateMany({ where: { id, revisao }, data: { ...dados, revisao: { increment: 1 } } });
    if (!r.count) throw new ErroNegocio("Formulário mudou. Recarregue.", 409);
    await auditar(tx, usuarioId, "recrutamento.formulario.alterado", "FormularioRecrutamento", id, { operacao: typeof entrada === "string" ? entrada : "EDITAR", revisao: revisao + 1 });
  });
}
export async function avaliarCandidatura(usuarioId: string, id: string, entrada: z.infer<typeof zAvaliacao>) {
  const b = zAvaliacao.parse(entrada);
  return db.$transaction(async tx => {
    await exigirGestaoRecrutamento(tx, usuarioId);
    const c = await tx.candidaturaRecrutamento.findUnique({ where: { id } }); if (!c) throw naoEncontrado("Candidatura");
    if (!c.formularioSnapshot) throw new ErroNegocio("Candidatura anterior ao novo modelo. Preserve o registro original; não atribua rubrica retroativa.");
    const d = zDefinicao.parse(c.formularioSnapshot); const resultado = calcularAvaliacao(d, b.criterios);
    const r = await tx.candidaturaRecrutamento.updateMany({ where: { id, versao: b.versao }, data: { versao: { increment: 1 } } });
    if (!r.count) throw new ErroNegocio("Candidatura alterada. Recarregue antes de avaliar.", 409);
    const a = await tx.avaliacaoRecrutamento.create({ data: { candidaturaId: id, etapa: b.etapa, criterios: b.criterios, nota: resultado.nota, cobertura: resultado.cobertura, usuarioId } });
    await auditar(tx, usuarioId, "recrutamento.avaliacao.registrada", "CandidaturaRecrutamento", id, { avaliacaoId: a.id, etapa: b.etapa });
    return resultado;
  });
}
