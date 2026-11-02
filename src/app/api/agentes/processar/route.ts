import { rota } from "@/lib/erros";
import { resposta } from "@/lib/estudio/http";
import { exigirAgentes } from "@/lib/agentes/acesso";
import { processarUmaExecucao } from "@/lib/agentes/processar";
export const maxDuration = 180;
export const POST = rota(async (req: Request) => resposta(await processarUmaExecucao((await exigirAgentes(req)).usuarioId)));
