import { cookies } from "next/headers";
import type { Papel } from "@prisma/client";
import { db } from "@/lib/db";
import { cookieSeguro } from "@/lib/dominios";
import { naoAutorizado, proibido } from "@/lib/erros";
import { assinarToken, COOKIE_SESSAO, DURACAO_SESSAO_S, lerToken, type Sessao } from "./token";

export { COOKIE_SESSAO, lerToken, type Sessao };

export async function criarSessao(s: Sessao) {
  (await cookies()).set(COOKIE_SESSAO, await assinarToken(s), {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSeguro(),
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

export const EQUIPE: Papel[] = ["DONO", "GERENTE", "LIDER", "RECEPCAO", "BARBEIRO"];
/** Dono e gerente: cadastros (servicos, planos, produtos, barbeiros), horarios de todos e configuracoes. */
export const LIDERANCA: Papel[] = ["DONO", "GERENTE", "LIDER"];
export const GESTAO: Papel[] = ["DONO", "GERENTE"];
/** Quem atende no balcao: gestao + recepcao (caixa, comandas, financeiro do dia, assinaturas...). */
export const BALCAO: Papel[] = ["DONO", "GERENTE", "RECEPCAO"];
/** Acoes sensiveis (estorno, desconto, folha...) dependem tambem da matriz de permissoes (lib/auth/permissoes.ts). */

export async function exigirSessao(papeis: Papel[] = EQUIPE): Promise<Sessao> {
  const s = await sessaoAtual();
  if (!s) throw naoAutorizado();
  if (!papeis.includes(s.papel)) throw proibido();
  return s;
}

/** Dono, gerente e recepcao mexem em qualquer agenda; barbeiro so na propria. */
export function podeGerirBarbeiro(s: Sessao, barbeiroId: string): boolean {
  if (BALCAO.includes(s.papel) || s.papel === "LIDER") return true;
  return EQUIPE.includes(s.papel) && s.barbeiroId === barbeiroId;
}

export function exigirGestaoBarbeiro(s: Sessao, barbeiroId: string) {
  if (!podeGerirBarbeiro(s, barbeiroId)) throw proibido();
}

/** Expediente, folgas e fechar agenda: dono, gerente ou o proprio barbeiro. */
export function podeConfigurarBarbeiro(s: Sessao, barbeiroId: string): boolean {
  return GESTAO.includes(s.papel) || (EQUIPE.includes(s.papel) && s.barbeiroId === barbeiroId);
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
