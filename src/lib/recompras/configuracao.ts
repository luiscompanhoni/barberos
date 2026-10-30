import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import type { Sessao } from "@/lib/auth/sessao";
import { proibido } from "@/lib/erros";
import type { ConfigRecompra } from "./schemas";

export const PADRAO = {
  ativo: false, whatsapp: false, intervaloContatoDias: 7, descontoAtivo: false,
  descontoPct: 0, descontoMaxCentavos: 0, descontoValidadeDias: 7, reativacaoDias: 30, margemMinimaPct: 0,
};
export async function configRecompras() {
  return (await db.recompraConfig.findUnique({ where: { id: 1 } })) ?? PADRAO;
}
export async function configuracaoTela(s: Sessao) {
  if (s.papel !== "DONO") throw proibido();
  const desde = new Date(Date.now() - 30 * 86_400_000);
  const [config, servicos, avisos, ofertas] = await Promise.all([
    configRecompras(),
    db.servico.findMany({ where: { ativo: true }, orderBy: { nome: "asc" }, select: { id: true, nome: true, intervaloRecompraDias: true, custoCentavos: true } }),
    db.recompraAviso.findMany({ orderBy: { criadoEm: "desc" }, take: 30, select: { id: true, estado: true, erro: true, tentativas: true, criadoEm: true, enviadoEm: true, cliente: { select: { nome: true } } } }),
    db.ofertaRecompra.findMany({ where: { criadoEm: { gte: desde } }, orderBy: { atualizadoEm: "asc" }, select: { clienteId: true, servicoId: true, ultimaEm: true, estado: true } }),
  ]);
  const ciclos = new Map(ofertas.map(o => [`${o.clienteId}:${o.servicoId}:${o.ultimaEm.toISOString()}`, o.estado]));
  const aceitas = [...ciclos.values()].filter(e => e === "ACEITOU").length;
  const recusadas = [...ciclos.values()].filter(e => e === "RECUSOU").length;
  return { config, servicos, avisos, conversao: { desde: desde.toISOString(), ofertas: ciclos.size, aceitas, recusadas, percentual: ciclos.size ? Math.round(aceitas * 100 / ciclos.size) : null } };
}
export async function salvarConfig(s: Sessao, input: ConfigRecompra) {
  if (s.papel !== "DONO") throw proibido();
  const { servicos, ...config } = input;
  await db.$transaction(async tx => {
    const anterior = await tx.recompraConfig.findUnique({ where: { id: 1 } });
    await tx.recompraConfig.upsert({ where: { id: 1 }, create: { id: 1, ...config }, update: config });
    for (const servico of servicos) {
      const { id, ...dados } = servico;
      const antes = await tx.servico.findUniqueOrThrow({ where: { id }, select: { intervaloRecompraDias: true, custoCentavos: true } });
      await tx.servico.update({ where: { id }, data: dados });
      if (JSON.stringify(antes) !== JSON.stringify(dados)) await auditar(tx, s.usuarioId, "recompra_servico", "servico", id, { antes, depois: dados });
    }
    await auditar(tx, s.usuarioId, "recompra_configurar", "recompra", "config", { antes: anterior ? { ativo: anterior.ativo, whatsapp: anterior.whatsapp, descontoAtivo: anterior.descontoAtivo } : null, depois: config });
  });
  return configuracaoTela(s);
}
