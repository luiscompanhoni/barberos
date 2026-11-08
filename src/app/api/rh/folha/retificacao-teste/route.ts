import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { urlPainel } from "@/lib/dominios";
import { proibido, rota } from "@/lib/erros";
import { json, resposta } from "@/lib/estudio/http";
import { parametros, zId } from "@/lib/validacao";
import { previaRetificacaoTeste, retificarTesteFolha } from "@/lib/rh/retificacao";
import { zRetificacaoTeste, zSalarioSubstitutivo } from "@/lib/rh/retificacao-regras";

export const dynamic = "force-dynamic";
export const GET = rota(async (req: Request) => {
  const s = await exigirSessao(["DONO"]);
  const d = parametros(req, z.object({ folhaId: zId, salarioSubstitutivoCentavos: z.coerce.number().pipe(zSalarioSubstitutivo) }).strict());
  return resposta(await previaRetificacaoTeste(s, d.folhaId, d.salarioSubstitutivoCentavos));
});
export const POST = rota(async (req: Request) => {
  const s = await exigirSessao(["DONO"]);
  const origem = req.headers.get("origin");
  if (req.headers.get("sec-fetch-site") === "cross-site" || (origem && origem !== new URL(urlPainel()).origin)) throw proibido();
  return resposta(await retificarTesteFolha(s, await json(req, zRetificacaoTeste)));
});
