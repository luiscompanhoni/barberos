import { rota } from "@/lib/erros";
import { equipe, json, resposta } from "@/lib/estudio/http";
import { zProjeto } from "@/lib/estudio/regras";
import { criar, listar } from "@/lib/estudio/servico";
export const runtime = "nodejs";
export const GET = rota(async (req: Request) => resposta(await listar((await equipe(req)).usuarioId)));
export const POST = rota(async (req: Request) => {
  const s = await equipe(req);
  return resposta({ id: await criar(s.usuarioId, (await json(req, zProjeto)).nome) }, 201);
});
