import type { z } from "zod";
import { auditar } from "@/lib/auditoria";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { conferirRevisao, hashAgente, zRotinaAgente, zAlterarRotina } from "./regras";
import { criarInterno, donoNaTransacao, transacaoAgentes } from "./repositorio";

export async function criarRotinaAgente(usuarioId: string, entrada: z.infer<typeof zRotinaAgente>) {
  const p = zRotinaAgente.parse(entrada);
  return transacaoAgentes(async tx => {
    await donoNaTransacao(tx, usuarioId);
    const chave = `${usuarioId}:${p.chave}`;
    const entradaHash = hashAgente({ ...p, usuarioId });
    const existe = await tx.agenteRotina.findUnique({ where: { chave } });
    if (existe) {
      if (existe.entradaHash !== entradaHash) throw new ErroNegocio("Chave já usada com outra rotina.", 409);
      return existe;
    }
    if (await tx.agenteRotina.count({ where: { usuarioId } }) >= 30) throw new ErroNegocio("Limite de 30 rotinas por responsável atingido.", 429);
    const r = await tx.agenteRotina.create({ data: { ...p, chave, entradaHash, usuarioId, proximaEm: new Date(Date.now() + p.cadaMinutos * 60_000) } });
    await auditar(tx, usuarioId, "agente.rotina_criada", "AgenteRotina", r.id, { agenteId: p.agenteId, ativa: p.ativa, cadaMinutos: p.cadaMinutos });
    return r;
  });
}
export async function alterarRotinaAgente(usuarioId: string, id: string, entrada: z.infer<typeof zAlterarRotina>) {
  const p = zAlterarRotina.parse(entrada);
  return transacaoAgentes(async tx => {
    await donoNaTransacao(tx, usuarioId);
    const r = await tx.agenteRotina.findFirst({ where: { id, usuarioId } });
    if (!r) throw naoEncontrado("Rotina");
    conferirRevisao(r.revisao, p.revisao);
    const atualizada = await tx.agenteRotina.update({ where: { id }, data: { ativa: p.ativa, revisao: { increment: 1 }, ...(p.ativa ? { proximaEm: new Date(Date.now() + r.cadaMinutos * 60_000) } : {}) } });
    await auditar(tx, usuarioId, "agente.rotina_alterada", "AgenteRotina", id, { ativa: p.ativa });
    return atualizada;
  });
}
export async function enfileirarRotinasAgentes(agora = new Date()) {
  return transacaoAgentes(async tx => {
    const cfg = await tx.agenteConfiguracao.findUniqueOrThrow({ where: { id: 1 } });
    if (cfg.pausada) return 0;
    const rotinas = await tx.agenteRotina.findMany({ where: { ativa: true, proximaEm: { lte: agora } }, take: 30, orderBy: { proximaEm: "asc" } });
    let criadas = 0;
    let abertas = await tx.agenteExecucao.count({ where: { estado: { in: ["PENDENTE", "EXECUTANDO", "AGUARDA_APROVACAO"] } } });
    for (const r of rotinas) {
      const u = await tx.usuario.findUnique({ where: { id: r.usuarioId }, select: { ativo: true, papel: true } });
      if (!u?.ativo || u.papel !== "DONO") {
        await tx.agenteRotina.update({ where: { id: r.id }, data: { ativa: false, revisao: { increment: 1 } } });
        await auditar(tx, null, "agente.rotina_suspensa", "AgenteRotina", r.id, { motivo: "responsavel_sem_acesso" });
        continue;
      }
      // Um único resultado pendente por rotina; parada longa não causa tempestade de execução.
      const aberta = await tx.agenteExecucao.findFirst({ where: { rotinaId: r.id, estado: { in: ["PENDENTE", "EXECUTANDO", "AGUARDA_APROVACAO"] } } });
      if (!aberta) {
        // Fila cheia não pode impedir que o trabalhador processe o que já está aguardando.
        if (abertas >= 100) break;
        await criarInterno(tx, { agenteId: r.agenteId, tarefa: r.tarefa, usuarioId: r.usuarioId, rotinaId: r.id, chave: `rotina:${r.id}:${r.proximaEm.toISOString()}` });
        criadas++; abertas++;
      }
      await tx.agenteRotina.update({ where: { id: r.id }, data: { proximaEm: new Date(+agora + r.cadaMinutos * 60_000) } });
    }
    return criadas;
  });
}
