import { cookies } from "next/headers";
import type { Papel } from "@prisma/client";
import { db } from "@/lib/db";
import { acessoUnicoCompativel, cookieSeguro, dominioDaSessao } from "@/lib/dominios";
import { ErroNegocio, naoAutorizado, proibido } from "@/lib/erros";
import { assinarToken, COOKIE_SESSAO, COOKIE_SESSAO_LEGADA, DURACAO_SESSAO_S, lerToken, tokenDoCookie, type Sessao } from "./token";

export { COOKIE_SESSAO, lerToken, type Sessao };

export async function criarSessao(s: Sessao) {
  if (!acessoUnicoCompativel()) throw new ErroNegocio("Configuração de acesso incompatível. A administração precisa usar o mesmo host ou site e subdomínio HTTPS.", 503, "dominios_incompativeis");
  (await cookies()).set(COOKIE_SESSAO, await assinarToken(s), {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSeguro(),
    path: "/",
    maxAge: DURACAO_SESSAO_S,
    domain: dominioDaSessao(),
  });
}

export async function encerrarSessao() {
  const jar = await cookies();
  jar.delete(COOKIE_SESSAO_LEGADA);
  // Tombstone compartilhado impede fallback para cookies host-only dos dois apps.
  jar.set(COOKIE_SESSAO, "", { httpOnly: true, sameSite: "lax", secure: cookieSeguro(), path: "/", domain: dominioDaSessao(), maxAge: DURACAO_SESSAO_S });
}

/**
 * Sessao atual, revalidada no banco (usuario desativado perde acesso na hora).
 */
export async function sessaoAtual(): Promise<Sessao | null> {
  const s = await lerToken(tokenDoCookie(await cookies()));
  if (!s) return null;
  const u = await db.usuario.findUnique({
    where: { id: s.usuarioId },
    include: { barbeiro: { select: { id: true, ativo: true } }, cliente: { select: { id: true, excluidoEm: true } } },
  });
  if (!u || !u.ativo) return null;
  if (u.papel === "CLIENTE" && (!u.cliente || u.cliente.excluidoEm)) return null;
  if ((s.sessaoVersao ?? 0) !== (u.sessaoVersao ?? 0)) return null;
  return {
    usuarioId: u.id,
    papel: u.papel,
    nome: u.nome,
    barbeiroId: u.barbeiro?.ativo ? u.barbeiro.id : null,
    clienteId: u.cliente?.id ?? null,
    sessaoVersao: u.sessaoVersao ?? 0,
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
