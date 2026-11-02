import { rota } from "@/lib/erros";
import { json, resposta } from "@/lib/estudio/http";
import { exigirAgentes } from "@/lib/agentes/acesso";
import { zRotinaAgente } from "@/lib/agentes/regras";
import { criarRotinaAgente } from "@/lib/agentes/rotinas";
export const POST = rota(async (req: Request) => resposta(await criarRotinaAgente((await exigirAgentes(req)).usuarioId, await json(req, zRotinaAgente)), 201));
