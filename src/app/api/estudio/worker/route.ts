import { z } from "zod";
import { rota } from "@/lib/erros";
import { exigirWorker, json, resposta } from "@/lib/estudio/http";
import { claim, finalizar, heartbeat } from "@/lib/estudio/servico";
const schema = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("claim"), versao: z.string().min(1).max(50) }),
  z.object({ acao: z.enum(["heartbeat", "falhar"]), id: z.string().min(1).max(40), lease: z.string().uuid() }),
]);
export const POST = rota(async (req: Request) => {
  exigirWorker(req);
  const d = await json(req, schema);
  if (d.acao === "claim") return resposta({ trabalho: await claim(d.versao) });
  if (d.acao === "heartbeat") await heartbeat(d.id, d.lease);
  else await finalizar(d.id, d.lease, null);
  return resposta({ ok: true });
});
