import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { urlSite } from "@/lib/dominios";
import { provedorPagamento } from "@/lib/pagamentos/gateway";
import { novoTokenPublico } from "./cobrancas";

const VALIDADE_SEGUNDOS = 24 * 3600;
const PREFIXO_CHECKOUT = "leonel_";
type PlanoAdesao = { id: string; precoCentavos: number };
type Titular = { clienteId: string; usuarioId: string };

export function adesaoLeonelDisponivel() {
  return process.env.LEONEL_CHECKOUT_ADESAO_ATIVO === "true" && provedorPagamento() === "pagarme";
}

function assinatura(telefone: string, plano: PlanoAdesao, expira: number) {
  const chave = process.env.SESSION_SECRET;
  if (!chave || chave.length < 32) return null;
  return createHmac("sha256", chave)
    .update(JSON.stringify(["adesao-leonel-v1", telefone, plano.id, plano.precoCentavos, expira]))
    .digest();
}

export function linkDeAdesaoLeonel(telefone: string, plano: PlanoAdesao, agora = Date.now()) {
  if (!adesaoLeonelDisponivel()) return null;
  const expira = Math.floor(agora / 1000) + VALIDADE_SEGUNDOS;
  const hmac = assinatura(telefone, plano, expira);
  if (!hmac) return null;
  const url = new URL("/c/planos", urlSite());
  url.searchParams.set("plano", plano.id);
  url.searchParams.set("leonel", `${expira}.${hmac.toString("base64url")}`);
  return url.href;
}

export function conviteDeAdesaoLeonelValido(convite: string, telefone: string, plano: PlanoAdesao, agora = Date.now()) {
  if (!adesaoLeonelDisponivel() || !/^\d{10}\.[A-Za-z0-9_-]{43}$/.test(convite)) return false;
  const [prazo, mac] = convite.split(".");
  const segundos = Math.floor(agora / 1000);
  const expira = Number(prazo);
  if (expira <= segundos || expira > segundos + VALIDADE_SEGUNDOS) return false;
  const recebido = Buffer.from(mac, "base64url");
  const esperado = assinatura(telefone, plano, expira);
  return !!esperado && recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}

export async function telefoneDoTitularLeonel(titular: Titular) {
  const c = await db.cliente.findFirst({
    where: { id: titular.clienteId, usuarioId: titular.usuarioId, excluidoEm: null },
    select: { telefone: true, usuario: { select: { ativo: true, papel: true, telefone: true, telefoneVerificadoEm: true } } },
  });
  return c?.usuario?.ativo && c.usuario.papel === "CLIENTE" && c.usuario.telefoneVerificadoEm &&
    c.telefone === c.usuario.telefone ? c.telefone : null;
}

export const novoTokenCheckoutLeonel = () => PREFIXO_CHECKOUT + novoTokenPublico();
export const ehCheckoutLeonel = (token: string) => /^leonel_[A-Za-z0-9_-]{24}$/.test(token);

export async function checkoutLeonelDoTitular(token: string, titular: Titular) {
  return (await telefoneDoTitularLeonel(titular)) !== null && !!await db.assinatura.findFirst({
    where: { tokenPublico: token, clienteId: titular.clienteId, origem: "BOT" }, select: { id: true },
  });
}
