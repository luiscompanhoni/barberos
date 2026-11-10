import { GESTAO, exigirSessao } from "@/lib/auth/sessao";
import { urlPainel } from "@/lib/dominios";
import { ErroNegocio, rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";
import { zSalvarEtiquetasServico } from "@/lib/servicos/etiquetas";
import { consultarEtiquetasServico, salvarEtiquetasServico } from "@/lib/servicos/etiquetas-servico";

const resposta = (dados: unknown) => Response.json(dados, { headers: { "Cache-Control": "private, no-store" } });

export const GET = rota(async (_req: Request, ctx: RouteContext<"/api/servicos/[id]/etiquetas">) => {
  await exigirSessao(GESTAO);
  return resposta(await consultarEtiquetasServico((await ctx.params).id));
});

export const PATCH = rota(async (req: Request, ctx: RouteContext<"/api/servicos/[id]/etiquetas">) => {
  const sessao = await exigirSessao(GESTAO);
  const origem = req.headers.get("origin");
  if (req.headers.get("sec-fetch-site") === "cross-site" || (origem !== null && origem !== new URL(urlPainel()).origin)) {
    throw new ErroNegocio("Origem da solicitação inválida.", 403);
  }
  const dados = await corpo(req, zSalvarEtiquetasServico, { maxBytes: 8192, tipoJson: true });
  return resposta(await salvarEtiquetasServico((await ctx.params).id, sessao.usuarioId, dados));
});
