import { z } from "zod";
import { auditar } from "@/lib/auditoria";
import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado, proibido } from "@/lib/erros";
import { publicarLotes } from "./resumos";

const nota = z.number().int().min(1).max(5);
export const schemaResposta = z.object({
  conviteId: z.string().min(1).max(40), nota,
  corte: nota.nullable().optional(), atendimento: nota.nullable().optional(), ambiente: nota.nullable().optional(), pontualidade: nota.nullable().optional(),
  comentario: z.string().trim().max(2000).optional(),
});

export async function responderAvaliacao(clienteId: string, entrada: z.infer<typeof schemaResposta>, agora = new Date()) {
  const { conviteId, ...dados } = schemaResposta.parse(entrada);
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`jogos:${clienteId}`}))`;
    const convite = await tx.conviteAvaliacao.findUnique({ where: { id: conviteId } });
    if (!convite || convite.clienteId !== clienteId) throw naoEncontrado("Convite");
    const existente = await tx.avaliacaoCliente.findUnique({ where: { conviteId } });
    if (existente) return { ok: true, repetida: true, recompensada: !!convite.jogoId };
    if (convite.expiraEm <= agora) throw new ErroNegocio("O prazo desta avaliação terminou.", 409, "convite_expirado");
    const agendamento = await tx.agendamento.findUnique({ where: { id: convite.agendamentoId }, select: { status: true, clienteId: true } });
    if (agendamento?.status !== "CONCLUIDO" || agendamento.clienteId !== clienteId) throw new ErroNegocio("Este atendimento não está concluído.", 409);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`avaliacoes:${convite.barbeiroId}`}))`;
    await tx.avaliacaoCliente.create({ data: { conviteId, ...dados, comentario: dados.comentario || null, criadoEm: agora } });
    if (convite.jogoId) {
      await tx.fichaJogo.createMany({ data: [{ clienteId, jogoId: convite.jogoId, origem: "AVALIACAO", referencia: convite.id,
        expiraEm: new Date(agora.getTime() + convite.recompensaValidadeDias * 86_400_000),
      }], skipDuplicates: true });
    }
    await tx.conviteAvaliacao.update({ where: { id: convite.id }, data: { respondidaEm: agora } });
    await publicarLotes(tx, convite.barbeiroId);
    return { ok: true, repetida: false, recompensada: !!convite.jogoId };
  });
}

/** Esta consulta identificável é exclusiva do dono e deixa trilha, sem copiar o texto para logs. */
export async function consultarIdentidadeAvaliacao(s: Sessao, id: string) {
  if (s.papel !== "DONO") throw proibido();
  return db.$transaction(async tx => {
    const resposta = await tx.avaliacaoCliente.findUnique({ where: { id }, include: {
      convite: { include: { cliente: { select: { nome: true } }, barbeiro: { select: { nome: true } } } },
    } });
    if (!resposta) throw naoEncontrado("Avaliação");
    await auditar(tx, s.usuarioId, "consultar_identidade_avaliacao", "avaliacao_cliente", id);
    return { id: resposta.id, cliente: resposta.convite.cliente.nome, barbeiro: resposta.convite.barbeiro.nome,
      nota: resposta.nota, corte: resposta.corte, atendimento: resposta.atendimento, ambiente: resposta.ambiente,
      pontualidade: resposta.pontualidade, comentario: resposta.comentario, criadoEm: resposta.criadoEm.toISOString() };
  });
}

export async function listarAvaliacoesDono(s: Sessao) {
  if (s.papel !== "DONO") throw proibido();
  // Lista mínima para abrir a consulta auditada; nenhuma identidade ou comentário na listagem.
  return db.avaliacaoCliente.findMany({ orderBy: { criadoEm: "desc" }, take: 100,
    select: { id: true, nota: true, criadoEm: true, convite: { select: { barbeiro: { select: { nome: true } } } } } });
}
