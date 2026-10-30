import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio } from "@/lib/erros";
import { publicarNotificacao } from "./caixa";
import { configuracaoPush } from "./configuracao";
import { processarPush } from "./envio";
import { hashPush, tokenDispositivoValido } from "./regras";

/** Teste é sempre do usuário logado; fila de terceiros nunca é drenada por esta rota. */
export async function testarNotificacoes(s: Sessao, token: string | null, agora = new Date()) {
  const cfg = configuracaoPush();
  const dispositivo = tokenDispositivoValido(token) ? await db.pushInscricao.findFirst({ where: { usuarioId: s.usuarioId, tokenHash: hashPush(token!), ativo: true }, select: { id: true } }) : null;
  if (cfg.modo === "real" && cfg.disponivel && !dispositivo) throw new ErroNegocio("Ative as notificações neste dispositivo antes de testar.", 422);
  const aviso = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`push:teste:${s.usuarioId}`}))`;
    const recente = await tx.notificacao.findFirst({ where: { usuarioId: s.usuarioId, categoria: "TESTE", criadoEm: { gt: new Date(+agora - 60_000) } }, select: { id: true } });
    if (recente) return { id: recente.id, criada: false };
    const tentativas = await tx.notificacao.count({ where: { usuarioId: s.usuarioId, categoria: "TESTE", criadoEm: { gt: new Date(+agora - 60 * 60_000) } } });
    if (tentativas >= 3) throw new ErroNegocio("Limite de três testes por hora. Aguarde antes de tentar novamente.", 429, "limite_teste_push");
    return publicarNotificacao({ usuarioId: s.usuarioId, categoria: "TESTE", chave: `teste:${Math.floor(+agora / 60_000)}`, titulo: "Teste de notificações", corpo: "Este aviso confirma que sua central está funcionando.", href: s.papel === "CLIENTE" ? "/c/notificacoes" : "/notificacoes", criadoEm: agora, expiraEm: new Date(+agora + 60 * 60_000) }, tx, { inscricaoIds: dispositivo ? [dispositivo.id] : [] });
  });
  const r = aviso?.criada && dispositivo ? await processarPush(agora, { usuarioId: s.usuarioId, notificacaoIds: [aviso.id], limite: 1 }) : null;
  const simulado = cfg.modo !== "real" || !cfg.disponivel;
  const mensagem = !aviso?.criada ? "Um teste já foi solicitado há menos de um minuto. Consulte a central."
    : simulado ? "Aviso de teste criado na central. O envio push está simulado ou desativado; nenhuma notificação real foi enviada ao sistema do aparelho."
    : r?.enviados ? "O serviço push aceitou o teste deste dispositivo. A exibição depende da permissão e das configurações do aparelho."
    : r?.incertos ? "O resultado do envio não pôde ser confirmado. O teste não será reenviado automaticamente."
    : "Aviso criado na central, mas o envio push não foi confirmado. Confira o estado deste dispositivo.";
  return { ok: true, simulado, mensagem };
}
