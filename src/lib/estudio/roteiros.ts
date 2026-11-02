import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { ErroNegocio, proibido } from "@/lib/erros";
import { hashAgente, conferirResultado } from "@/lib/agentes/regras";
import { agentesHabilitados } from "@/lib/agentes/acesso";
import { exigirHabilitado } from "./http";
import { transacao } from "./servico";
import { LIMITES } from "./regras";
import { PRESET_PADRAO, TEMPLATES } from "./templates";
import { zImportarRoteiro, zRoteiro, type ImportarRoteiro, type Roteiro } from "./roteiro-tipos";

async function conferirAcesso(tx: Prisma.TransactionClient, usuarioId: string) {
  exigirHabilitado();
  if (!agentesHabilitados()) throw new ErroNegocio("Central de agentes desabilitada.", 503);
  const u = await tx.usuario.findUnique({ where: { id: usuarioId }, select: { papel: true, ativo: true } });
  if (!u?.ativo || u.papel !== "DONO") throw proibido();
}
export async function listarRoteiros(usuarioId: string, execucaoId?: string) {
  await conferirAcesso(db, usuarioId);
  const id = zImportarRoteiro.shape.execucaoId.optional().parse(execucaoId);
  const where: Prisma.AgenteExecucaoWhereInput = { solicitanteId: usuarioId, agenteId: "conteudo", estado: "CONCLUIDO", aprovadoEm: { not: null }, aprovadoPorId: { not: null }, resultadoHash: { not: null } };
  const select = { id: true, tarefa: true, revisao: true, resultadoHash: true, aprovadoEm: true } as const;
  const [recentes, selecionado] = await Promise.all([
    db.agenteExecucao.findMany({ where, select, orderBy: [{ aprovadoEm: "desc" }, { id: "desc" }], take: 50 }),
    id ? db.agenteExecucao.findFirst({ where: { ...where, id }, select }) : null,
  ]);
  return selecionado ? [selecionado, ...recentes.filter(r => r.id !== selecionado.id)] : recentes;
}
/** Copia evidência aprovada; não chama IA nem enfileira render ou encaminhamento. */
export async function importarRoteiro(usuarioId: string, entrada: ImportarRoteiro) {
  const e = zImportarRoteiro.parse(entrada);
  return transacao(async tx => {
    await tx.$queryRaw`SELECT id FROM usuarios WHERE id = ${usuarioId} FOR SHARE`;
    await conferirAcesso(tx, usuarioId);
    // O bloqueio da linha mantém a origem estável até o commit, inclusive entre módulos.
    await tx.$queryRaw`SELECT id FROM agente_execucoes WHERE id = ${e.execucaoId} AND "solicitanteId" = ${usuarioId} FOR UPDATE`;
    const ex = await tx.agenteExecucao.findFirst({ where: { id: e.execucaoId, solicitanteId: usuarioId, agenteId: "conteudo" } });
    if (!ex || ex.estado !== "CONCLUIDO" || !ex.aprovadoPorId || !ex.aprovadoEm || !ex.resultado || !ex.resultadoHash) throw new ErroNegocio("Selecione um roteiro seu, aprovado na Central de Agentes.", 409);
    if (ex.revisao !== e.revisao || ex.resultadoHash !== e.resultadoHash || hashAgente(ex.resultado) !== ex.resultadoHash) throw new ErroNegocio("O roteiro mudou. Atualize a lista antes de importar.", 409);
    const resultado = conferirResultado("conteudo", ex.resultado);
    const anterior = await tx.estudioProjeto.findUnique({ where: { usuarioId_origemExecucaoId: { usuarioId, origemExecucaoId: ex.id } } });
    if (anterior) {
      if (zRoteiro.parse(anterior.roteiro).resultadoHash !== ex.resultadoHash) throw new ErroNegocio("O projeto já guarda outra versão deste roteiro. Confira a origem antes de continuar.", 409);
      return { id: anterior.id, reutilizado: true };
    }
    if (await tx.estudioProjeto.count({ where: { usuarioId } }) >= LIMITES.projetos) throw new ErroNegocio("Limite de 10 projetos atingido.", 409);
    const roteiro: Roteiro = { execucaoId: ex.id, agenteId: "conteudo", tarefa: ex.tarefa, revisao: ex.revisao, resultadoHash: ex.resultadoHash,
      aprovadoPorId: ex.aprovadoPorId, aprovadoEm: ex.aprovadoEm.toISOString(), importadoEm: new Date().toISOString(), importadoPorId: usuarioId,
      ...resultado };
    const preset = e.preset ?? PRESET_PADRAO;
    const { titulo, chamada } = TEMPLATES[preset];
    const p = await tx.estudioProjeto.create({ data: { nome: e.nome, usuarioId, preset, titulo, chamada, origemExecucaoId: ex.id, roteiro } });
    await auditar(tx, usuarioId, "estudio.importar-roteiro", "EstudioProjeto", p.id, { execucaoId: ex.id, resultadoHash: ex.resultadoHash, revisao: ex.revisao });
    return { id: p.id, reutilizado: false };
  });
}
