import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao, GESTAO } from "@/lib/auth/sessao";
import { MENSAGEM_PADRAO, MENSAGEM_PADRAO_ROLETA } from "@/lib/campanhas/regras";
import { campanhasBloqueadas, criarCampanha, listarCampanhas, prepararCampanhasPorSegmento, resumoSegmentos } from "@/lib/campanhas/servico";
import { schemaCampanha } from "@/lib/campanhas/schemas";
import { rota } from "@/lib/erros";
import { listarJogos, noAr } from "@/lib/jogos/motor";
import { corpoCobrancaEquipe } from "@/lib/pagamentos/http-equipe";

export const dynamic = "force-dynamic";

/** Segmentos da base (tamanhos) e campanhas com os numeros de cada uma. */
export const GET = rota(async () => {
  await exigirSessao(GESTAO);
  const [segmentos, campanhas, jogos] = await Promise.all([resumoSegmentos(), listarCampanhas(), listarJogos()]);
  return NextResponse.json({
    ...segmentos, campanhas, enviosBloqueados: campanhasBloqueadas(),
    mensagemPadrao: MENSAGEM_PADRAO, mensagemPadraoRoleta: MENSAGEM_PADRAO_ROLETA,
    // Jogos no ar que podem ir de presente no link.
    jogos: jogos.filter((j) => noAr(j)).map((j) => ({ id: j.id, nome: j.nome })),
  });
});

export const POST = rota(async (req: Request) => {
  const s = await exigirSessao(GESTAO);
  const b = await corpoCobrancaEquipe(req, z.union([z.object({ acao: z.literal("preparar_segmentos") }).strict(), schemaCampanha]));
  if ("acao" in b) return NextResponse.json(await prepararCampanhasPorSegmento(s));
  return NextResponse.json(await criarCampanha(s, b), { status: 201 });
});
