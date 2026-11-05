import { createHmac } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import { urlSite } from "@/lib/dominios";
import { ErroNegocio } from "@/lib/erros";

export const PROVEDORES_SOCIAIS = ["google", "facebook", "apple"] as const;
export const zProvedorSocial = z.enum(PROVEDORES_SOCIAIS);
export type ProvedorSocial = z.infer<typeof zProvedorSocial>;
export type IdentidadeVerificada = { provedor: ProvedorSocial; subject: string; nome?: string; email?: string };
const googleChaves = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const appleChaves = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));
const indisponivel = () => new ErroNegocio("Este acesso ainda não está disponível. Entre com celular e senha.", 503, "social_indisponivel");
const falhou = () => new ErroNegocio("Não foi possível validar esse acesso. Comece novamente.", 401, "social_invalido");

export function configuracaoSocial(provedor: ProvedorSocial) {
  const prefixo = `AUTH_${provedor.toUpperCase()}`;
  const clientId = process.env[`${prefixo}_CLIENT_ID`]?.trim();
  const secret = process.env[`${prefixo}_CLIENT_SECRET`]?.trim();
  const versao = process.env.AUTH_FACEBOOK_API_VERSION?.trim();
  const site = new URL(urlSite());
  if (!clientId || !secret || (site.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(site.hostname))) return null;
  if (provedor === "apple" && site.protocol !== "https:") return null;
  if (provedor === "facebook" && !/^v\d+\.\d+$/.test(versao ?? "")) return null;
  return { clientId, secret, versao, callback: `${site.origin}/api/auth/social/${provedor}/retorno` };
}

export function provedoresDisponiveis() {
  return PROVEDORES_SOCIAIS.map((id) => ({ id, disponivel: Boolean(configuracaoSocial(id)) }));
}

export function urlAutorizacao(provedor: ProvedorSocial, state: string, nonce: string, desafio: string) {
  const c = configuracaoSocial(provedor);
  if (!c) throw indisponivel();
  const destino = provedor === "google" ? "https://accounts.google.com/o/oauth2/v2/auth"
    : provedor === "apple" ? "https://appleid.apple.com/auth/authorize" : `https://www.facebook.com/${c.versao}/dialog/oauth`;
  const u = new URL(destino);
  u.search = new URLSearchParams({ client_id: c.clientId, redirect_uri: c.callback, response_type: "code", state,
    scope: provedor === "google" ? "openid email profile" : provedor === "apple" ? "name email" : "email,public_profile" }).toString();
  if (provedor !== "facebook") u.searchParams.set("nonce", nonce);
  if (provedor === "google") {
    u.searchParams.set("code_challenge", desafio); u.searchParams.set("code_challenge_method", "S256");
  }
  if (provedor === "apple") u.searchParams.set("response_mode", "form_post");
  return u.toString();
}

async function buscar(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  try {
    const r = await fetch(url, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000) });
    if (!r.ok) throw falhou();
    const dados: unknown = await r.json();
    if (!dados || typeof dados !== "object" || Array.isArray(dados)) throw falhou();
    return dados as Record<string, unknown>;
  } catch { throw falhou(); }
}

/** O e-mail é apenas sugestão de cadastro; nunca é a chave para vincular uma conta. */
export async function verificarIdentidadeSocial(provedor: ProvedorSocial, code: string, nonce: string, verificador: string) {
  const c = configuracaoSocial(provedor);
  if (!c) throw indisponivel();
  const endpoint = provedor === "google" ? "https://oauth2.googleapis.com/token"
    : provedor === "apple" ? "https://appleid.apple.com/auth/token" : `https://graph.facebook.com/${c.versao}/oauth/access_token`;
  const body = new URLSearchParams({ client_id: c.clientId, client_secret: c.secret, code, redirect_uri: c.callback, grant_type: "authorization_code" });
  if (provedor === "google") body.set("code_verifier", verificador);
  const token = await buscar(endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (provedor === "facebook") return identidadeFacebook(c, token);
  if (typeof token.id_token !== "string") throw falhou();
  try {
    const { payload } = await jwtVerify(token.id_token, provedor === "google" ? googleChaves : appleChaves, {
      audience: c.clientId, issuer: provedor === "google" ? ["https://accounts.google.com", "accounts.google.com"] : "https://appleid.apple.com",
      algorithms: ["RS256"], requiredClaims: ["exp", "iat", "sub", "nonce"], maxTokenAge: "10m",
    });
    if (payload.nonce !== nonce || !payload.sub || payload.sub.length > 255) throw falhou();
    const verificado = payload.email_verified === true || payload.email_verified === "true";
    return { provedor, subject: payload.sub,
      nome: typeof payload.name === "string" ? payload.name.slice(0, 60) : undefined,
      email: verificado && typeof payload.email === "string" ? payload.email.slice(0, 254) : undefined } satisfies IdentidadeVerificada;
  } catch { throw falhou(); }
}

async function identidadeFacebook(c: NonNullable<ReturnType<typeof configuracaoSocial>>, token: Record<string, unknown>): Promise<IdentidadeVerificada> {
  if (typeof token.access_token !== "string") throw falhou();
  const base = `https://graph.facebook.com/${c.versao}`;
  const parametros = new URLSearchParams({ input_token: token.access_token, access_token: `${c.clientId}|${c.secret}` });
  const debug = await buscar(`${base}/debug_token?${parametros}`);
  const d = debug.data as Record<string, unknown> | undefined;
  if (!d || d.is_valid !== true || d.app_id !== c.clientId || typeof d.user_id !== "string" || !d.user_id ||
      typeof d.expires_at !== "number" || d.expires_at <= Date.now() / 1000 ||
      (typeof d.data_access_expires_at === "number" && d.data_access_expires_at > 0 && d.data_access_expires_at <= Date.now() / 1000)) throw falhou();
  const proof = createHmac("sha256", c.secret).update(token.access_token).digest("hex");
  const perfil = await buscar(`${base}/me?fields=id,name,email&appsecret_proof=${proof}`, { headers: { Authorization: `Bearer ${token.access_token}` } });
  if (perfil.id !== d.user_id || d.user_id.length > 255) throw falhou();
  return { provedor: "facebook", subject: d.user_id,
    nome: typeof perfil.name === "string" ? perfil.name.slice(0, 60) : undefined,
    email: typeof perfil.email === "string" ? perfil.email.slice(0, 254) : undefined };
}
