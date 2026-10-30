import { createHash, ECDH } from "node:crypto";
import type { CategoriaNotificacao, PreferenciasNotificacoes } from "./tipos";

export const COOKIE_DISPOSITIVO_PUSH = "bb_push_dispositivo";
export const PREFERENCIAS_PADRAO: PreferenciasNotificacoes = { agenda: true, avaliacoes: true, recompra: false, equipe: true };
export const MAX_DISPOSITIVOS = 10;
export const hashPush = (valor: string) => createHash("sha256").update(valor).digest("hex");
export const tokenDispositivoValido = (valor?: string | null) => !!valor && /^[A-Za-z0-9_-]{43}$/.test(valor);

export function categoriaPermitida(categoria: string, p: PreferenciasNotificacoes) {
  if (categoria === "TESTE") return true;
  const campos: Record<Exclude<CategoriaNotificacao, "TESTE">, keyof PreferenciasNotificacoes> = {
    AGENDA: "agenda", AVALIACAO: "avaliacoes", RECOMPRA: "recompra", EQUIPE: "equipe",
  };
  return categoria in campos ? p[campos[categoria as keyof typeof campos]] : false;
}

function bytesBase64Url(valor: string, tamanho: number) {
  if (!/^[A-Za-z0-9_-]+$/.test(valor)) return null;
  const bytes = Buffer.from(valor, "base64url");
  return bytes.length === tamanho && bytes.toString("base64url") === valor ? bytes : null;
}
export function chavePublicaValida(valor: string) {
  const bytes = bytesBase64Url(valor, 65);
  if (!bytes || bytes[0] !== 4) return false;
  try { return ECDH.convertKey(bytes, "prime256v1").length === 65; } catch { return false; }
}
export const authPushValido = (valor: string) => !!bytesBase64Url(valor, 16);

/** Endpoints são capacidade de envio: nunca aceitar servidores arbitrários nem redirecionamentos. */
export function endpointPushValido(endpoint: string) {
  if (endpoint.length > 4096) return false;
  try {
    const u = new URL(endpoint);
    if (u.protocol !== "https:" || u.username || u.password || u.hash || (u.port && u.port !== "443")) return false;
    if (u.hostname === "fcm.googleapis.com") return /^\/(?:fcm\/send|wp)\/[A-Za-z0-9_:.-]+$/.test(u.pathname) && !u.search;
    if (u.hostname === "updates.push.services.mozilla.com") return /^\/wpush\/v[12]\/[A-Za-z0-9_=-]+$/.test(u.pathname) && !u.search;
    if (u.hostname === "web.push.apple.com") return /^\/[A-Za-z0-9_=/.-]+$/.test(u.pathname) && u.pathname.length > 1 && !u.search;
    if (/^[a-z0-9-]+\.notify\.windows\.com$/.test(u.hostname)) return u.pathname === "/" && !!u.searchParams.get("token") && [...u.searchParams.keys()].every((k) => k === "token");
    return false;
  } catch { return false; }
}

/** Navegação fica restrita às áreas autenticadas; nenhum destino externo entra no push. */
export function hrefNotificacaoValido(href: string) {
  if (href.length > 500 || !href.startsWith("/") || href.startsWith("//") || /[\\\r\n]|%2f|%5c/i.test(href)) return false;
  try {
    const u = new URL(href, "https://barberos.invalid");
    return u.origin === "https://barberos.invalid" && ["/c", "/meu-dia", "/minha-agenda", "/desempenho", "/reunioes", "/notificacoes"].some((p) => u.pathname === p || u.pathname.startsWith(`${p}/`));
  } catch { return false; }
}

export type ResultadoProvedorPush = { estado: "ENVIADO" | "SIMULADO" | "INCERTO" | "FALHOU" | "PENDENTE"; codigo: string | null; desativar?: boolean; esperarSegundos?: number };
export function resultadoErroPush(erro: unknown): ResultadoProvedorPush {
  const e = erro as { statusCode?: unknown; headers?: Record<string, unknown> } | null;
  const status = typeof e?.statusCode === "number" ? e.statusCode : null;
  if (status === 404 || status === 410) return { estado: "FALHOU", codigo: `HTTP_${status}`, desativar: true };
  if (status === 429) {
    const segundos = Number(e?.headers?.["retry-after"]);
    return { estado: "PENDENTE", codigo: "HTTP_429", esperarSegundos: Number.isFinite(segundos) && segundos > 0 ? Math.min(3600, Math.max(60, segundos)) : 300 };
  }
  if (status && status !== 408) return { estado: "FALHOU", codigo: `HTTP_${Math.trunc(status)}` };
  return { estado: "INCERTO", codigo: status === 408 ? "HTTP_408" : "ENVIO_INDETERMINADO" };
}
