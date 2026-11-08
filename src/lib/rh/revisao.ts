import { createHash } from "node:crypto";
function canonico(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(canonico).sort((a, b) => {
    const x = JSON.stringify(a), y = JSON.stringify(b); return x < y ? -1 : x > y ? 1 : 0;
  });
  if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => [k, canonico(x)]));
  return v;
}
export const revisaoApuracao = (v: unknown) => createHash("sha256").update(JSON.stringify(canonico(v))).digest("hex");
