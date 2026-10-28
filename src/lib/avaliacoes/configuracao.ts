import { z } from "zod";
import { auditar } from "@/lib/auditoria";
import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio, proibido } from "@/lib/erros";

export const schemaConfiguracaoAvaliacao = z.object({
  ativo: z.boolean(), whatsapp: z.boolean(), jogoId: z.string().min(1).max(40).nullable(),
  validadeDias: z.number().int().min(1).max(90), recompensaValidadeDias: z.number().int().min(1).max(365),
});

export async function configuracaoAvaliacao() {
  return await db.avaliacaoConfig.findUnique({ where: { id: 1 } }) ?? {
    id: 1, ativo: false, whatsapp: false, jogoId: null, ativaDesde: null, validadeDias: 14, recompensaValidadeDias: 30,
  };
}

export async function painelConfiguracaoAvaliacao(s: Sessao) {
  if (s.papel !== "DONO") throw proibido();
  const [configuracao, jogos, falhasWhatsApp] = await Promise.all([
    configuracaoAvaliacao(),
    db.jogo.findMany({ where: { ativo: true, soAssinante: false }, select: { id: true, nome: true, tipo: true }, orderBy: { ordem: "asc" } }),
    db.automacaoEnviada.count({ where: { tipo: "AVALIACAO", ok: false } }),
  ]);
  return { configuracao, jogos, falhasWhatsApp };
}

export async function salvarConfiguracaoAvaliacao(s: Sessao, dados: z.infer<typeof schemaConfiguracaoAvaliacao>) {
  if (s.papel !== "DONO") throw proibido();
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('avaliacoes:config'))`;
    if (dados.jogoId) {
      const jogo = await tx.jogo.findUnique({ where: { id: dados.jogoId } });
      const agora = new Date();
      if (!jogo || !jogo.ativo || jogo.soAssinante || (jogo.inicioEm && jogo.inicioEm > agora) || (jogo.fimEm && jogo.fimEm <= agora)) {
        throw new ErroNegocio("Escolha um jogo ativo e disponível para todos os clientes.");
      }
    }
    const antes = await tx.avaliacaoConfig.findUnique({ where: { id: 1 } });
    const ativaDesde = dados.ativo && !antes?.ativo ? new Date() : antes?.ativaDesde ?? null;
    const depois = await tx.avaliacaoConfig.upsert({ where: { id: 1 }, create: { id: 1, ...dados, ativaDesde }, update: { ...dados, ativaDesde } });
    await auditar(tx, s.usuarioId, "configurar_avaliacoes", "avaliacao_config", "1", { antes, depois });
    return depois;
  });
}
