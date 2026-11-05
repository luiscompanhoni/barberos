import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { EncryptJWT, jwtDecrypt } from "jose";
import { z } from "zod";
import { urlSite } from "@/lib/dominios";
import { zProvedorSocial, type IdentidadeVerificada } from "./social-provedores";

export const COOKIE_SOCIAL_NAVEGADOR = "barberos_social_navegador";
const COOKIE_PENDENTE = "barberos_social_pendente";
const esquema = z.object({ provedor: zProvedorSocial, subject: z.string().min(1).max(255), nome: z.string().max(60).optional(), email: z.string().max(254).optional() });
function chave() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET ausente ou curto.");
  return createHash("sha256").update(`social-pendente:${s}`).digest();
}
export const socialSeguro = () => new URL(urlSite()).protocol === "https:";
export async function guardarIdentidadePendente(identidade: IdentidadeVerificada) {
  const token = await new EncryptJWT({ ...identidade }).setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt().setExpirationTime("10m").setAudience("cadastro-social").encrypt(chave());
  (await cookies()).set(COOKIE_PENDENTE, token, { httpOnly: true, secure: socialSeguro(), sameSite: "lax", path: "/", maxAge: 600 });
}
export async function identidadePendente() {
  const token = (await cookies()).get(COOKIE_PENDENTE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtDecrypt(token, chave(), { audience: "cadastro-social", keyManagementAlgorithms: ["dir"], contentEncryptionAlgorithms: ["A256GCM"] });
    return esquema.parse(payload);
  } catch { return null; }
}
export async function limparIdentidadePendente() { (await cookies()).delete(COOKIE_PENDENTE); }
