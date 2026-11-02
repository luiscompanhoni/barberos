import { rota } from "@/lib/erros";
import { exigirAgentes } from "@/lib/agentes/acesso";
import { exigirHabilitado, json, resposta } from "@/lib/estudio/http";
import { zImportarRoteiro } from "@/lib/estudio/roteiro-tipos";
import { importarRoteiro, listarRoteiros } from "@/lib/estudio/roteiros";
export const runtime = "nodejs";
export const GET = rota(async (req: Request) => {
  exigirHabilitado(); const s = await exigirAgentes(req);
  return resposta({ roteiros: await listarRoteiros(s.usuarioId, new URL(req.url).searchParams.get("execucaoId") ?? undefined) });
});
export const POST = rota(async (req: Request) => {
  exigirHabilitado(); const s = await exigirAgentes(req);
  const resultado = await importarRoteiro(s.usuarioId, await json(req, zImportarRoteiro));
  return resposta(resultado, resultado.reutilizado ? 200 : 201);
});
