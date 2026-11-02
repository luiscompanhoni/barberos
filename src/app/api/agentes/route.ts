import { rota } from "@/lib/erros";
import { json, resposta } from "@/lib/estudio/http";
import { exigirAgentes } from "@/lib/agentes/acesso";
import { zConfigAgentes, zCriarExecucao } from "@/lib/agentes/regras";
import { configurarAgentes, criarExecucao, painelAgentes } from "@/lib/agentes/servico";
export const GET = rota(async () => resposta(await painelAgentes((await exigirAgentes()).usuarioId)));
export const POST = rota(async (req: Request) => resposta(await criarExecucao((await exigirAgentes(req)).usuarioId, await json(req, zCriarExecucao)), 201));
export const PATCH = rota(async (req: Request) => resposta(await configurarAgentes((await exigirAgentes(req)).usuarioId, await json(req, zConfigAgentes))));
