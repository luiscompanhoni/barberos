import type { z } from "zod";
import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { AGENTES } from "./catalogo";
import { conferirDono, execucaoHabilitada } from "./acesso";
import { integracoesAgentes } from "./integracoes";
import { criarInterno, donoNaTransacao, execucaoPublica, transacaoAgentes } from "./repositorio";
import { conferirResultado, conferirRevisao, hashAgente, zAcaoExecucao, zConfigAgentes, zCriarExecucao } from "./regras";
import type { PainelAgentes } from "./tipos";

async function trabalhosVisiveis(usuarioId: string) {
  const [abertos, recentes] = await db.$transaction([
    db.agenteExecucao.findMany({ where: { solicitanteId: usuarioId, estado: { in: ["PENDENTE", "EXECUTANDO", "AGUARDA_APROVACAO"] } }, take: 100, orderBy: { criadoEm: "desc" } }),
    db.agenteExecucao.findMany({ where: { solicitanteId: usuarioId, estado: { notIn: ["PENDENTE", "EXECUTANDO", "AGUARDA_APROVACAO"] } }, take: 100, orderBy: { criadoEm: "desc" } }),
  ], { isolationLevel: "RepeatableRead" });
  // Um mesmo retrato evita duplicatas se uma tarefa encerrar entre as duas consultas.
  // Conclusões recentes não podem esconder pendências que ainda ocupam a fila.
  return [...abertos, ...recentes].slice(0, 100);
}
export async function painelAgentes(usuarioId: string): Promise<PainelAgentes> {
  await conferirDono({ usuarioId });
  const [execucoes, rotinas, configuracao] = await Promise.all([
    trabalhosVisiveis(usuarioId),
    db.agenteRotina.findMany({ where: { usuarioId }, orderBy: { criadoEm: "desc" }, take: 50 }),
    db.agenteConfiguracao.findUniqueOrThrow({ where: { id: 1 } }),
  ]);
  return { catalogo: AGENTES.map(({ id, nome, objetivo, grupo, integracoes, proximos }) => ({ id, nome, objetivo, grupo, integracoes, proximos })),
    integracoes: integracoesAgentes(), execucoes: execucoes.map(execucaoPublica),
    rotinas: rotinas.map(r => ({ id: r.id, nome: r.nome, agenteId: r.agenteId, tarefa: r.tarefa, cadaMinutos: r.cadaMinutos, ativa: r.ativa, revisao: r.revisao, proximaEm: r.proximaEm.toISOString() })),
    configuracao: { pausada: configuracao.pausada, limiteDiario: configuracao.limiteDiario, revisao: configuracao.revisao }, execucaoHabilitada: execucaoHabilitada() };
}
export async function criarExecucao(usuarioId: string, entrada: z.infer<typeof zCriarExecucao>) {
  const p = zCriarExecucao.parse(entrada);
  return transacaoAgentes(async tx => {
    await donoNaTransacao(tx, usuarioId);
    return execucaoPublica(await criarInterno(tx, { ...p, usuarioId, chave: `${usuarioId}:${p.chave}` }));
  });
}
export async function configurarAgentes(usuarioId: string, entrada: z.infer<typeof zConfigAgentes>) {
  const p = zConfigAgentes.parse(entrada);
  return transacaoAgentes(async tx => {
    await donoNaTransacao(tx, usuarioId);
    const atual = await tx.agenteConfiguracao.findUniqueOrThrow({ where: { id: 1 } });
    conferirRevisao(atual.revisao, p.revisao);
    const r = await tx.agenteConfiguracao.update({ where: { id: 1 }, data: { pausada: p.pausada, limiteDiario: p.limiteDiario, revisao: { increment: 1 } } });
    await auditar(tx, usuarioId, "agente.configuracao", "AgenteConfiguracao", "1", { pausada: p.pausada, limiteDiario: p.limiteDiario });
    return r;
  });
}
export async function decidirExecucao(usuarioId: string, id: string, entrada: z.infer<typeof zAcaoExecucao>) {
  const p = zAcaoExecucao.parse(entrada);
  return transacaoAgentes(async tx => {
    await donoNaTransacao(tx, usuarioId);
    const r = await tx.agenteExecucao.findFirst({ where: { id, solicitanteId: usuarioId } });
    if (!r) throw naoEncontrado("Tarefa");
    if (p.acao === "aprovar" && r.estado === "CONCLUIDO" && r.resultadoHash === p.resultadoHash) return execucaoPublica(r);
    conferirRevisao(r.revisao, p.revisao);
    if (p.acao === "aprovar") {
      if (r.estado !== "AGUARDA_APROVACAO" || !r.resultado || !p.resultadoHash || p.resultadoHash !== r.resultadoHash || hashAgente(r.resultado) !== p.resultadoHash) {
        throw new ErroNegocio("Revise o resultado atual antes de aprovar.", 409, "aprovacao_agente");
      }
      const resultado = conferirResultado(r.agenteId, r.resultado);
      if (r.profundidade >= 4 && resultado.proximosPassos.length) throw new ErroNegocio("Limite de encaminhamentos alcançado. Abra uma tarefa independente para continuar.");
      // Libera a vaga do pai na mesma transação; falha em qualquer filho desfaz toda a aprovação.
      const atualizado = await tx.agenteExecucao.update({ where: { id }, data: { estado: "CONCLUIDO", aprovadoPorId: usuarioId, aprovadoEm: new Date(), revisao: { increment: 1 } } });
      for (const [i, prox] of resultado.proximosPassos.entries()) {
        await criarInterno(tx, { ...prox, usuarioId, chave: `encaminhamento:${id}:${r.resultadoHash}:${i}`, origemId: id, profundidade: r.profundidade + 1 });
      }
      await auditar(tx, usuarioId, "agente.resultado_aprovado", "AgenteExecucao", id, { hash: r.resultadoHash, encaminhamentos: resultado.proximosPassos.map(x => x.agenteId), efeito: "tarefas_internas_sem_envio" });
      return execucaoPublica(atualizado);
    }
    if (p.acao === "repetir") {
      if (!["FALHOU", "BLOQUEADO"].includes(r.estado)) throw new ErroNegocio("Somente tarefa falha ou bloqueada pode ser repetida.", 409);
      const emAberto = await tx.agenteExecucao.findFirst({ where: { chave: { startsWith: `repetir:${id}:` }, solicitanteId: usuarioId, estado: { in: ["PENDENTE", "EXECUTANDO", "AGUARDA_APROVACAO"] } } });
      if (emAberto) return execucaoPublica(emAberto);
      if (r.rotinaId && await tx.agenteExecucao.count({ where: { rotinaId: r.rotinaId, estado: { in: ["PENDENTE", "EXECUTANDO", "AGUARDA_APROVACAO"] } } })) {
        throw new ErroNegocio("A rotina já tem outro trabalho em aberto. Revise-o antes de repetir.", 409, "rotina_em_aberto");
      }
      await tx.agenteExecucao.update({ where: { id }, data: { revisao: { increment: 1 } } });
      const nova = await criarInterno(tx, { agenteId: r.agenteId, tarefa: r.tarefa, usuarioId, origemId: r.origemId ?? id, rotinaId: r.rotinaId ?? undefined, profundidade: r.profundidade, chave: `repetir:${id}:${r.revisao}` });
      await auditar(tx, usuarioId, "agente.tarefa_repetida", "AgenteExecucao", id, { novaExecucaoId: nova.id, origemId: nova.origemId, rotinaId: nova.rotinaId });
      return execucaoPublica(nova);
    }
    if (["CONCLUIDO", "CANCELADO"].includes(r.estado)) throw new ErroNegocio("A tarefa já está encerrada.", 409);
    const atualizado = await tx.agenteExecucao.update({ where: { id }, data: { estado: "CANCELADO", lease: null, leaseAte: null, finalizadoEm: new Date(), revisao: { increment: 1 } } });
    await auditar(tx, usuarioId, "agente.tarefa_cancelada", "AgenteExecucao", id, { estadoAnterior: r.estado });
    return execucaoPublica(atualizado);
  });
}
