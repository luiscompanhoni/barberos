import type { z } from "zod";
import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { zEdicaoVaga } from "./regras";
import { conferirFormulario } from "./vinculo-formulario";
import { exigirGestaoRecrutamento } from "./formularios";
export async function alterarVaga(usuarioId: string, entrada: z.infer<typeof zEdicaoVaga>) {
  const b = zEdicaoVaga.parse(entrada);
  return db.$transaction(async tx => {
    await exigirGestaoRecrutamento(tx, usuarioId);
    const { id, versao, ...dados } = b; const editando = "titulo" in b;
    const atual = await tx.vagaRecrutamento.findUnique({ where: { id } });
    if (!atual) throw naoEncontrado("Vaga");
    if (atual.versao !== versao) throw new ErroNegocio("Vaga alterada. Recarregue antes de continuar.", 409);
    if (editando && atual.ativa) throw new ErroNegocio("Encerre as inscrições antes de editar a vaga.", 409);
    if (editando || b.ativa) await conferirFormulario(tx, "formularioId" in b && b.formularioId !== undefined ? b.formularioId : atual.formularioId);
    const r = await tx.vagaRecrutamento.updateMany({ where: { id, versao, ...(editando ? { ativa: false } : {}) }, data: { ...dados, versao: { increment: 1 } } });
    if (!r.count) throw new ErroNegocio("Vaga alterada. Recarregue antes de continuar.", 409);
    await auditar(tx, usuarioId, editando ? "recrutamento.vaga.editada" : "recrutamento.vaga.publicacao", "VagaRecrutamento", id, { ativa: b.ativa, versao: versao + 1, formularioId: "formularioId" in b && b.formularioId !== undefined ? b.formularioId : atual.formularioId });
  });
}
