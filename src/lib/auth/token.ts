import { jwtVerify, SignJWT } from "jose";
import type { Papel } from "@prisma/client";

// Separado de sessao.ts para o proxy nao carregar o Prisma.
export const COOKIE_SESSAO = "barberos_sessao";
export const DURACAO_SESSAO_S = 60 * 60 * 24 * 30; // 30 dias

export type Sessao = {
  usuarioId: string;
  papel: Papel;
  nome: string;
  barbeiroId: string | null;
  clienteId: string | null;
};

function chave() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET ausente ou curto (mínimo 32 caracteres).");
  return new TextEncoder().encode(s);
}

export async function assinarToken(s: Sessao): Promise<string> {
  return new SignJWT({ ...s })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${DURACAO_SESSAO_S}s`)
    .sign(chave());
}

export async function lerToken(token: string | undefined): Promise<Sessao | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, chave());
    return payload as unknown as Sessao;
  } catch {
    return null;
  }
}
