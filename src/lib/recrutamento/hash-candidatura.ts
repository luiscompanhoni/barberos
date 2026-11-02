import { createHash } from "node:crypto";
import type { z } from "zod";
import type { zCandidatura } from "./regras";
function ordenar(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(ordenar);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b, "en")).map(([k, x]) => [k, ordenar(x)]));
  return v;
}
export function hashesCandidatura(vagaId: string, b: z.infer<typeof zCandidatura>) {
  const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
  const normalizado = { vagaId, ...b, servicos: [...b.servicos].sort(), ...(b.respostas ? { respostas: Object.fromEntries(Object.entries(b.respostas).map(([k, v]) => [k, Array.isArray(v) ? [...v].sort() : v])) } : {}) };
  // Reconhece reenvio idêntico gerado antes desta revisão, sem regravar o registro.
  return { conteudoHash: hash(ordenar(normalizado)), legadoHash: hash({ vagaId, ...b }) };
}
