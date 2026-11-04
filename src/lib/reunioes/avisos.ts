import { z } from "zod";
import { auditar } from "@/lib/auditoria";
import { permissoesDoUsuario } from "@/lib/auth/permissoes";
import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";

export const criarAvisoSchema = z.object({ tipo: z.enum(["AVISO", "OBJETIVO"]), texto: z.string().trim().min(3).max(500) }).strict();
export const editarAvisoSchema = criarAvisoSchema.extend({ versao: z.number().int().positive(), concluido: z.boolean() }).strict();

async function acesso(s: Sessao) {
  if (!["DONO", "GERENTE", "LIDER"].includes(s.papel) || !(await permissoesDoUsuario(s)).reunioes) {
    throw new ErroNegocio("Seu acesso não permite avisos de reuniões.", 403);
  }
}

export async function listarAvisos(s: Sessao) {
  await acesso(s);
  return db.avisoReuniao.findMany({ orderBy: [{ concluido: "asc" }, { criadoEm: "desc" }], take: 100 });
}

export async function criarAviso(s: Sessao, entrada: unknown) {
  await acesso(s);
  const d = criarAvisoSchema.parse(entrada);
  return db.$transaction(async tx => {
    const aviso = await tx.avisoReuniao.create({ data: { tipo: d.tipo, texto: d.texto, criadoPorId: s.usuarioId } });
    await auditar(tx, s.usuarioId, "reuniao_aviso_criar", "aviso_reuniao", aviso.id, { versao: aviso.versao });
    return aviso;
  });
}

export async function editarAviso(s: Sessao, id: string, entrada: unknown) {
  await acesso(s);
  const d = editarAvisoSchema.parse(entrada);
  return db.$transaction(async tx => {
    const anterior = await tx.avisoReuniao.findUnique({ where: { id } });
    if (!anterior) throw naoEncontrado("Aviso");
    const r = await tx.avisoReuniao.updateMany({ where: { id, versao: d.versao }, data: {
      tipo: d.tipo, texto: d.texto, concluido: d.concluido, versao: { increment: 1 },
    } });
    if (!r.count) throw new ErroNegocio("Outra pessoa alterou o aviso. Atualize a lista antes de salvar.", 409, "conflito");
    await auditar(tx, s.usuarioId, "reuniao_aviso_editar", "aviso_reuniao", id, { versaoAnterior: d.versao, concluido: d.concluido });
    return tx.avisoReuniao.findUniqueOrThrow({ where: { id } });
  });
}
