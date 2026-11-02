import { Prisma, type AgenteExecucao } from "@prisma/client";
import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { conferirDono } from "./acesso";
import { conferirResultado, hashAgente } from "./regras";
import type { ExecucaoAgente } from "./tipos";

export type TxAgente = Prisma.TransactionClient;
/** Uma trava curta serializa fila, configuração e decisões; rede nunca fica na transação. */
export function transacaoAgentes<T>(fn: (tx: TxAgente) => Promise<T>) {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(78243190)`;
    return fn(tx);
  });
}
export async function donoNaTransacao(tx: TxAgente, usuarioId: string) {
  const u = await tx.usuario.findUnique({ where: { id: usuarioId }, select: { ativo: true, papel: true } });
  if (!u?.ativo || u.papel !== "DONO") throw new ErroNegocio("Acesso aos agentes revogado.", 403);
}
export async function criarInterno(tx: TxAgente, p: { agenteId: string; tarefa: string; chave: string; usuarioId: string; origemId?: string; profundidade?: number; rotinaId?: string }) {
  const entradaHash = hashAgente({ agenteId: p.agenteId, tarefa: p.tarefa, usuarioId: p.usuarioId, origemId: p.origemId ?? null });
  const existe = await tx.agenteExecucao.findUnique({ where: { chave: p.chave } });
  if (existe) {
    if (existe.entradaHash !== entradaHash) throw new ErroNegocio("Chave já usada com outra tarefa.", 409, "idempotencia_agente");
    return existe;
  }
  if ((p.profundidade ?? 0) > 4) throw new ErroNegocio("Limite de encaminhamentos atingido. Crie uma nova tarefa após revisar o resultado.", 422);
  const pendentes = await tx.agenteExecucao.count({ where: { estado: { in: ["PENDENTE", "EXECUTANDO", "AGUARDA_APROVACAO"] } } });
  if (pendentes >= 100) throw new ErroNegocio("A fila atingiu 100 tarefas abertas. Revise ou cancele antes de adicionar outras.", 429);
  const { usuarioId, ...dados } = p;
  const r = await tx.agenteExecucao.create({ data: { ...dados, solicitanteId: usuarioId, entradaHash } });
  await auditar(tx, usuarioId, "agente.tarefa_criada", "AgenteExecucao", r.id, { agenteId: r.agenteId, origemId: r.origemId });
  return r;
}
export function execucaoPublica(r: AgenteExecucao): ExecucaoAgente {
  const contexto = r.contexto as { fontes?: { nome: string; consultadoEm: string }[] } | null;
  return { id: r.id, agenteId: r.agenteId, tarefa: r.tarefa, estado: r.estado, revisao: r.revisao,
    resultado: r.resultado ? conferirResultado(r.agenteId, r.resultado) : null,
    resultadoHash: r.resultadoHash, erro: r.erro, criadoEm: r.criadoEm.toISOString(), finalizadoEm: r.finalizadoEm?.toISOString() ?? null,
    origemId: r.origemId, fontes: (contexto?.fontes ?? []).map(f => ({ nome: f.nome, consultadoEm: f.consultadoEm })),
    modelo: r.modelo, tokensEntrada: r.tokensEntrada, tokensSaida: r.tokensSaida };
}
export async function buscarExecucao(id: string, usuarioId: string) {
  await conferirDono({ usuarioId });
  const r = await db.agenteExecucao.findFirst({ where: { id, solicitanteId: usuarioId } });
  if (!r) throw naoEncontrado("Tarefa");
  return r;
}
