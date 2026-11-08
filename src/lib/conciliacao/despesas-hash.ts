import { createHash } from "node:crypto";

/** Representação independente da ordem das chaves e da localidade de Windows/Linux. */
export function canonicoConferencia(v: unknown): string {
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (Array.isArray(v)) return `[${v.map(canonicoConferencia).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => `${JSON.stringify(k)}:${canonicoConferencia(x)}`).join(",")}}`;
  return JSON.stringify(v) ?? "null";
}
export const hashConferencia = (v: unknown) => createHash("sha256").update(canonicoConferencia(v)).digest("hex");
export const hashParDespesa = (movimento: unknown, despesa: unknown) => hashConferencia({ versao: 1, movimento, despesa });

export function parDecididoDistinto(dados: unknown, movimento: { id: string }, despesa: { id: string }) {
  if (!dados || typeof dados !== "object" || Array.isArray(dados)) return false;
  const d = dados as Record<string, unknown>;
  return d.movimentoId === movimento.id && d.despesaId === despesa.id && d.hashPar === hashParDespesa(movimento, despesa);
}
