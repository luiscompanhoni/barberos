import type { Cliente } from "@prisma/client";
import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { mudancas } from "@/lib/auditoria-regras";
import { travarClienteAgenda } from "@/lib/agenda/cliente-identidade";
import { naoEncontrado } from "@/lib/erros";

type DadosCadastro = Partial<Pick<Cliente, "dataNascimento" | "origem" | "origemDetalhe" | "observacoes">>;

/** A ficha antiga do atendimento participa do mesmo ciclo de vida de agenda/exclusão. */
export async function atualizarCadastroAtendimento(id: string, dados: DadosCadastro, usuarioId: string) {
  return db.$transaction(async tx => {
    await travarClienteAgenda(tx, id);
    await tx.$queryRaw`SELECT id FROM clientes WHERE id = ${id} FOR UPDATE`;
    const atual = await tx.cliente.findUnique({ where: { id } });
    if (!atual || atual.excluidoEm) throw naoEncontrado("Cliente");
    const delta = mudancas(atual, dados);
    if (delta) await auditar(tx, usuarioId, "alterar", "cliente", id, {
      origem: "cadastro_atendimento", campos: Object.keys(delta.depois),
    });
    return tx.cliente.update({ where: { id }, data: dados,
      select: { dataNascimento: true, origem: true, origemDetalhe: true, observacoes: true } });
  });
}
