import { createHash, createHmac } from "node:crypto";
import { ErroNegocio } from "@/lib/erros";
export function tokenEntrevista(e: { id: string; geracao: number }) {
  const chave = process.env.SESSION_SECRET;
  if (!chave || chave.length < 32) throw new ErroNegocio("Configure a chave de sessão antes de gerar convites.", 503);
  return createHmac("sha256", chave).update(`recrutamento-entrevista-v1:${e.id}:${e.geracao}`).digest("base64url");
}
export const hashTokenEntrevista = (token: string) => createHash("sha256").update(token).digest("hex");
