import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { ErroNegocio, naoEncontrado, proibido } from "@/lib/erros";
import { urlSite } from "@/lib/dominios";
import { hashTokenEntrevista, tokenEntrevista } from "./entrevistas-token";
import { donoEntrevista, travarAgenda, travarCandidaturaEntrevista, type Entrevista } from "./entrevistas";
export function linkEntrevista(e: Entrevista) {
  return `${urlSite()}/entrevistas#${tokenEntrevista(e)}`;
}
export async function gerirEntrevista(usuarioId: string, id: string, versao: number, acao: "CANCELAR" | "RENOVAR", agora = Date.now()) {
  return db.$transaction(async tx => {
    await donoEntrevista(tx, usuarioId); await travarAgenda(tx, usuarioId);
    const e = await tx.entrevistaRecrutamento.findUnique({ where: { id } }); if (!e) throw naoEncontrado("Entrevista");
    if (e.donoId !== usuarioId) throw proibido();
    await travarCandidaturaEntrevista(tx, e.candidaturaId);
    if (e.versao !== versao || e.estado === "CANCELADA") throw new ErroNegocio("Entrevista alterada ou cancelada. Recarregue.", 409);
    if (e.inicio && +e.inicio <= agora) throw new ErroNegocio("Entrevista já iniciada. Preserve o histórico e registre o acompanhamento.", 409);
    const renovacao = acao === "RENOVAR";
    if (renovacao) {
      const outro = await tx.entrevistaRecrutamento.findFirst({ where: { id: { not: id }, candidaturaId: e.candidaturaId, OR: [{ estado: { in: ["CONVIDADO", "AGUARDA_CONFIRMACAO"] }, expiraEm: { gt: new Date(agora) } }, { estado: "CONFIRMADA", fim: { gt: new Date(agora) } }] } });
      if (outro) throw new ErroNegocio("Já existe outro convite ou entrevista ativa para esta candidatura.", 409);
      const c = await tx.candidaturaRecrutamento.findUniqueOrThrow({ where: { id: e.candidaturaId } });
      if (["ENCERRADO", "CONTRATADO"].includes(c.etapa)) throw new ErroNegocio("Esta candidatura não está em seleção.", 409);
    }
    const geracao = e.geracao + 1;
    const tokenHash = hashTokenEntrevista(tokenEntrevista({ id, geracao }));
    const r = await tx.entrevistaRecrutamento.updateMany({ where: { id, versao }, data: renovacao ? {
      geracao, tokenHash, conversaId: null, versao: { increment: 1 }, expiraEm: e.fim ? new Date(+e.fim + 86400_000) : new Date(agora + 7 * 86400_000),
      ...(e.estado !== "CONFIRMADA" ? { estado: "CONVIDADO", propostaInicio: null, propostaExpiraEm: null } : {}),
    } : { estado: "CANCELADA", canceladoEm: new Date(agora), conversaId: null, versao: { increment: 1 } } });
    if (!r.count) throw new ErroNegocio("Entrevista alterada. Recarregue.", 409);
    await auditar(tx, usuarioId, `recrutamento.entrevista.${acao.toLowerCase()}`, "EntrevistaRecrutamento", id, {});
  });
}
