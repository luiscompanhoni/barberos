import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import type { Sessao } from "@/lib/auth/sessao";
import { ErroNegocio } from "@/lib/erros";

export async function configuracaoOperacional() {
  const [cadeiras, barbeiros, servicos] = await Promise.all([
    db.cadeira.findMany({ orderBy: { nome: "asc" } }),
    db.barbeiro.findMany({ where: { ativo: true }, select: { id: true, nome: true, cadeiraId: true }, orderBy: { nome: "asc" } }),
    db.servico.findMany({ where: { ativo: true }, select: { id: true, nome: true, duracaoMin: true, minimoDuracaoMin: true, barbeiros: { select: { barbeiroId: true, duracaoMin: true, minimoDuracaoMin: true } } }, orderBy: { nome: "asc" } }),
  ]);
  return { cadeiras, barbeiros, servicos };
}

type Mudanca = { tipo: "cadeira"; barbeiroId: string; cadeiraId: string | null }
  | { tipo: "minimo"; servicoId: string; barbeiroId?: string; minutos: number | null };

export async function salvarConfiguracaoOperacional(s: Sessao, b: Mudanca) {
  if (s.papel !== "DONO") throw new ErroNegocio("Somente o dono configura a agenda.", 403);
  await db.$transaction(async tx => {
    if (b.tipo === "cadeira") {
      if (b.cadeiraId && !(await tx.cadeira.findFirst({ where: { id: b.cadeiraId, ativa: true } }))) throw new ErroNegocio("Escolha uma cadeira ativa.");
      const antes = await tx.barbeiro.findUniqueOrThrow({ where: { id: b.barbeiroId }, select: { cadeiraId: true } });
      await tx.barbeiro.update({ where: { id: b.barbeiroId }, data: { cadeiraId: b.cadeiraId } });
      await auditar(tx, s.usuarioId, "cadeira_padrao", "barbeiro", b.barbeiroId, { antes, depois: { cadeiraId: b.cadeiraId } });
    } else {
      const servico = await tx.servico.findUniqueOrThrow({ where: { id: b.servicoId } });
      if (b.barbeiroId) {
        const where = { barbeiroId_servicoId: { barbeiroId: b.barbeiroId, servicoId: b.servicoId } };
        const bs = await tx.barbeiroServico.findUniqueOrThrow({ where });
        if ((b.minutos ?? servico.minimoDuracaoMin) > (bs.duracaoMin ?? servico.duracaoMin)) throw new ErroNegocio("O mínimo não pode superar a duração padrão deste profissional.");
        await tx.barbeiroServico.update({ where, data: { minimoDuracaoMin: b.minutos } });
        await auditar(tx, s.usuarioId, "duracao_minima", "servico", b.servicoId, { barbeiroId: b.barbeiroId, antes: bs.minimoDuracaoMin, depois: b.minutos });
      } else {
        if (b.minutos === null || b.minutos > servico.duracaoMin) throw new ErroNegocio("Informe um mínimo até a duração padrão.");
        const invalidos = await tx.barbeiroServico.count({ where: { servicoId: b.servicoId, minimoDuracaoMin: null, duracaoMin: { lt: b.minutos } } });
        if (invalidos) throw new ErroNegocio("Há profissionais com duração menor. Configure uma exceção de mínimo para eles primeiro.");
        await tx.servico.update({ where: { id: b.servicoId }, data: { minimoDuracaoMin: b.minutos } });
        await auditar(tx, s.usuarioId, "duracao_minima", "servico", b.servicoId, { antes: servico.minimoDuracaoMin, depois: b.minutos });
      }
    }
  });
  return configuracaoOperacional();
}
