import { cookies } from "next/headers";
import type { Papel } from "@prisma/client";
import { db } from "@/lib/db";
import { naoAutorizado, proibido } from "@/lib/erros";
import { assinarToken, COOKIE_SESSAO, DURACAO_SESSAO_S, lerToken, type Sessao } from "./token";

export { COOKIE_SESSAO, lerToken, type Sessao };

export async function criarSessao(s: Sessao) {
  (await cookies()).set(COOKIE_SESSAO, await assinarToken(s), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DURACAO_SESSAO_S,
  });
}

export async function encerrarSessao() {
  (await cookies()).delete(COOKIE_SESSAO);
}

/**
 * Sessao atual, revalidada no banco (usuario desativado perde acesso na hora).
 */
export async function sessaoAtual(): Promise<Sessao | null> {
  const s = await lerToken((await cookies()).get(COOKIE_SESSAO)?.value);
  if (!s) return null;
  const u = await db.usuario.findUnique({
    where: { id: s.usuarioId },
    include: { barbeiro: { select: { id: true, ativo: true } }, cliente: { select: { id: true } } },
  });
  if (!u || !u.ativo) return null;
  return {
    usuarioId: u.id,
    papel: u.papel,
    nome: u.nome,
    barbeiroId: u.barbeiro?.ativo ? u.barbeiro.id : null,
    clienteId: u.cliente?.id ?? null,
  };
}

export const EQUIPE: Papel[] = ["DONO", "RECEPCAO", "BARBEIRO"];

export async function exigirSessao(papeis: Papel[] = EQUIPE): Promise<Sessao> {
  const s = await sessaoAtual();
  if (!s) throw naoAutorizado();
  if (!papeis.includes(s.papel)) throw proibido();
  return s;
}

/** Dono e recepcao mexem em qualquer agenda; barbeiro so na propria. */
export function podeGerirBarbeiro(s: Sessao, barbeiroId: string): boolean {
  if (s.papel === "DONO" || s.papel === "RECEPCAO") return true;
  return s.papel === "BARBEIRO" && s.barbeiroId === barbeiroId;
}

export function exigirGestaoBarbeiro(s: Sessao, barbeiroId: string) {
  if (!podeGerirBarbeiro(s, barbeiroId)) throw proibido();
}

/** Expediente, folgas e fechar agenda: so o dono ou o proprio barbeiro. */
export function podeConfigurarBarbeiro(s: Sessao, barbeiroId: string): boolean {
  return s.papel === "DONO" || (s.papel === "BARBEIRO" && s.barbeiroId === barbeiroId);
}

export function exigirConfigBarbeiro(s: Sessao, barbeiroId: string) {
  if (!podeConfigurarBarbeiro(s, barbeiroId)) throw proibido();
}

/** Sessao de cliente com cadastro ligado (area do cliente). */
export async function exigirCliente(): Promise<Sessao & { clienteId: string }> {
  const s = await exigirSessao(["CLIENTE"]);
  if (!s.clienteId) throw naoAutorizado();
  return s as Sessao & { clienteId: string };
}
