import { createHash } from "node:crypto";
import { limitar } from "@/lib/limite";
import { normalizarTelefone } from "@/lib/telefone";

const hash = (v: string) => createHash("sha256").update(v).digest("hex");

/** Freio anterior ao corpo e ao scrypt; a trava persistente por conta continua no banco. */
export function limitarOrigemAutenticacao(req: Request) {
  const ip = (req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "sem-ip").slice(0, 80);
  limitar("auth:global", 600, 60_000);
  limitar(`auth:origem:${hash(ip)}`, 60, 60_000);
}

export function limitarIdentificadorSenha(identificador: string) {
  const chave = normalizarTelefone(identificador) ?? identificador.trim().toLowerCase();
  limitar(`auth:senha:${hash(chave)}`, 30, 15 * 60_000);
}
