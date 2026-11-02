import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { Modelo } from "@/lib/bot/agente";
import { auditar } from "@/lib/auditoria";
import { ErroNegocio } from "@/lib/erros";
import { db } from "@/lib/db";
import { conferirDono, execucaoHabilitada } from "./acesso";
import { contextoAgente } from "./contexto";
import { produzirResultado, FalhaResultadoAgente, type ConsumoAgente } from "./modelo";
import { hashAgente, inicioLimiteDiario } from "./regras";
import { criarInterno, execucaoPublica, transacaoAgentes } from "./repositorio";
import { destinoAutomatico } from "./encaminhamentos";

async function reservar(usuarioId?: string) {
  if (!execucaoHabilitada()) throw new ErroNegocio("Execução de IA não habilitada. Nenhuma chamada foi feita.", 503, "agentes_desabilitados");
  const agora = new Date();
  return transacaoAgentes(async tx => {
    const cfg = await tx.agenteConfiguracao.findUniqueOrThrow({ where: { id: 1 } });
    if (cfg.pausada) return null;
    const vencidas = await tx.agenteExecucao.findMany({ where: { estado: "EXECUTANDO", leaseAte: { lte: agora } } });
    for (const v of vencidas) {
      await tx.agenteExecucao.update({ where: { id: v.id }, data: { estado: "FALHOU", erro: "O processador foi interrompido. Confira antes de repetir; o modelo pode ter consumido tokens.", lease: null, leaseAte: null, finalizadoEm: agora, revisao: { increment: 1 } } });
      await auditar(tx, null, "agente.execucao_interrompida", "AgenteExecucao", v.id);
    }
    if (await tx.agenteExecucao.count({ where: { estado: "EXECUTANDO" } })) return null;
    if (await tx.agenteExecucao.count({ where: { iniciadoEm: { gte: inicioLimiteDiario(agora) } } }) >= cfg.limiteDiario) return null;
    const pendentes = await tx.agenteExecucao.findMany({ where: { estado: "PENDENTE", ...(usuarioId ? { solicitanteId: usuarioId } : {}) }, orderBy: { criadoEm: "asc" }, take: 100 });
    for (const r of pendentes) {
      const u = await tx.usuario.findUnique({ where: { id: r.solicitanteId }, select: { ativo: true, papel: true } });
      if (!u?.ativo || u.papel !== "DONO") {
        await tx.agenteExecucao.update({ where: { id: r.id }, data: { estado: "BLOQUEADO", erro: "Responsável sem acesso à central.", revisao: { increment: 1 } } });
        await auditar(tx, null, "agente.execucao_bloqueada", "AgenteExecucao", r.id);
        continue;
      }
      const atual = await tx.agenteExecucao.update({ where: { id: r.id }, data: { estado: "EXECUTANDO", lease: randomUUID(), leaseAte: new Date(+agora + 15 * 60_000), iniciadoEm: agora, revisao: { increment: 1 } } });
      await auditar(tx, r.solicitanteId, "agente.execucao_iniciada", "AgenteExecucao", r.id, { agenteId: r.agenteId });
      return atual;
    }
    return null;
  });
}

export async function processarUmaExecucao(usuarioId?: string, deps: { modelo?: Modelo; contexto?: typeof contextoAgente } = {}) {
  if (usuarioId) await conferirDono({ usuarioId });
  const r = await reservar(usuarioId);
  if (!r) return { processado: false };
  let consumo: ConsumoAgente | undefined;
  try {
    const origem = r.origemId ? await db.agenteExecucao.findUnique({ where: { id: r.origemId }, select: { estado: true, resultado: true, solicitanteId: true } }) : null;
    if (origem && origem.solicitanteId !== r.solicitanteId) throw new ErroNegocio("Origem da tarefa inválida.", 403);
    const contexto = await (deps.contexto ?? contextoAgente)(r.agenteId, r.solicitanteId, origem?.resultado ? { estado: origem.estado, resultado: origem.resultado, observacao: "Encaminhamento interno; não autoriza publicação, contato ou gasto." } : null);
    const atual = await db.agenteExecucao.findUniqueOrThrow({ where: { id: r.id } });
    if (atual.estado !== "EXECUTANDO" || atual.lease !== r.lease) return { processado: false };
    if (!atual.leaseAte || atual.leaseAte <= new Date()) throw new ErroNegocio("Prazo da execução vencido antes da chamada ao modelo.", 409, "reserva_vencida");
    await conferirDono({ usuarioId: r.solicitanteId });
    if (!execucaoHabilitada() || (await db.agenteConfiguracao.findUniqueOrThrow({ where: { id: 1 } })).pausada) throw new ErroNegocio("Execução pausada antes da chamada ao modelo.", 409);
    const saida = await produzirResultado(r.agenteId, r.tarefa, contexto, deps.modelo);
    consumo = { modelo: saida.modelo, tokensEntrada: saida.tokensEntrada, tokensSaida: saida.tokensSaida };
    return await transacaoAgentes(async tx => {
      const corrente = await tx.agenteExecucao.findUniqueOrThrow({ where: { id: r.id } });
      const u = await tx.usuario.findUnique({ where: { id: r.solicitanteId }, select: { ativo: true, papel: true } });
      const autorizado = u?.ativo && u.papel === "DONO";
      const vigente = corrente.estado === "EXECUTANDO" && corrente.lease === r.lease && corrente.leaseAte && corrente.leaseAte >= new Date();
      if (!vigente || !autorizado) {
        // Cancelar ou revogar não recupera tokens de uma chamada já aceita pelo provedor.
        // Registra só o consumo; descarta conteúdo e não cria tarefas derivadas.
        await tx.agenteExecucao.update({ where: { id: r.id }, data: {
          modelo: saida.modelo, tokensEntrada: saida.tokensEntrada, tokensSaida: saida.tokensSaida,
          revisao: { increment: 1 },
          ...(corrente.estado === "EXECUTANDO" ? { estado: autorizado ? "FALHOU" : "BLOQUEADO", erro: autorizado ? "Prazo da execução vencido; resultado descartado." : "Responsável sem acesso à central.", lease: null, leaseAte: null, finalizadoEm: new Date() } : {}),
        } });
        await auditar(tx, null, "agente.resultado_descartado", "AgenteExecucao", r.id, { motivo: autorizado ? "execucao_nao_vigente" : "acesso_revogado", modelo: saida.modelo, tokensEntrada: saida.tokensEntrada, tokensSaida: saida.tokensSaida });
        return { processado: false };
      }
      const resultadoHash = hashAgente(saida.resultado);
      const fim = await tx.agenteExecucao.update({ where: { id: r.id }, data: {
        estado: "AGUARDA_APROVACAO", contexto: JSON.parse(JSON.stringify(contexto)) as Prisma.InputJsonValue,
        resultado: saida.resultado, resultadoHash, modelo: saida.modelo, tokensEntrada: saida.tokensEntrada, tokensSaida: saida.tokensSaida,
        finalizadoEm: new Date(), lease: null, leaseAte: null, erro: null, revisao: { increment: 1 },
      } });
      await auditar(tx, r.solicitanteId, "agente.resultado_preparado", "AgenteExecucao", r.id, { hash: resultadoHash, modelo: saida.modelo, tokensEntrada: saida.tokensEntrada, tokensSaida: saida.tokensSaida, efeitoExterno: false });
      const destino = destinoAutomatico(r.agenteId, r.profundidade);
      const cfg = await tx.agenteConfiguracao.findUniqueOrThrow({ where: { id: 1 } });
      const filaAberta = await tx.agenteExecucao.count({ where: { estado: { in: ["PENDENTE", "EXECUTANDO", "AGUARDA_APROVACAO"] } } });
      if (!cfg.pausada && filaAberta < 100 && destino) {
        const indice = saida.resultado.proximosPassos.findIndex(p => p.agenteId === destino);
        if (indice >= 0) {
          await criarInterno(tx, { ...saida.resultado.proximosPassos[indice], usuarioId: r.solicitanteId, chave: `encaminhamento:${r.id}:${resultadoHash}:${indice}`, origemId: r.id, profundidade: r.profundidade + 1 });
          await auditar(tx, r.solicitanteId, "agente.rascunho_encaminhado", "AgenteExecucao", r.id, { destino });
        }
      }
      return { processado: true, execucao: execucaoPublica(fim) };
    });
  } catch (e) {
    consumo ??= e instanceof FalhaResultadoAgente ? e.consumo : undefined;
    const mensagem = e instanceof ErroNegocio ? e.message : "A execução falhou ou excedeu o tempo. Nenhuma ação externa foi executada. Confira as integrações antes de repetir.";
    await transacaoAgentes(async tx => {
      const atual = await tx.agenteExecucao.findUniqueOrThrow({ where: { id: r.id } });
      if (consumo) {
        await tx.agenteExecucao.update({ where: { id: r.id }, data: { ...consumo, revisao: { increment: 1 } } });
        await auditar(tx, null, "agente.consumo_falha", "AgenteExecucao", r.id, consumo);
      }
      if (atual.estado !== "EXECUTANDO" || atual.lease !== r.lease) return;
      await tx.agenteExecucao.update({ where: { id: r.id }, data: { estado: "FALHOU", erro: mensagem.slice(0, 500), lease: null, leaseAte: null, finalizadoEm: new Date(), revisao: { increment: 1 } } });
      await auditar(tx, r.solicitanteId, "agente.execucao_falhou", "AgenteExecucao", r.id, { codigo: e instanceof ErroNegocio ? e.codigo : "falha_provedor" });
    });
    return { processado: true, execucao: execucaoPublica(await db.agenteExecucao.findUniqueOrThrow({ where: { id: r.id } })) };
  }
}
