import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { cookieSeguro, urlPainel, urlSite } from "@/lib/dominios";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { configuracaoPush } from "./configuracao";
import { authPushValido, chavePublicaValida, COOKIE_DISPOSITIVO_PUSH, endpointPushValido, hashPush, MAX_DISPOSITIVOS, tokenDispositivoValido } from "./regras";
import type { DispositivoPushDto } from "./tipos";

export const zInscricaoPush = z.object({
  endpoint: z.string().max(4096).refine(endpointPushValido, "Provedor de push não aceito."),
  keys: z.object({ p256dh: z.string().max(100).refine(chavePublicaValida, "Chave de inscrição inválida."), auth: z.string().max(30).refine(authPushValido, "Autenticação de inscrição inválida.") }).strict(),
  nome: z.string().trim().min(1).max(60).default("Navegador"),
  expirationTime: z.number().finite().nullable().optional(),
}).strict();

export async function tokenDoDispositivo() {
  const token = (await cookies()).get(COOKIE_DISPOSITIVO_PUSH)?.value;
  return tokenDispositivoValido(token) ? token! : null;
}
export async function gravarCookieDispositivo(token: string) {
  (await cookies()).set(COOKIE_DISPOSITIVO_PUSH, token, { httpOnly: true, secure: cookieSeguro(), sameSite: "strict", path: "/", maxAge: 60 * 60 * 24 * 365 });
}

/** Retorna o token só ao route handler, para cookie HttpOnly; nunca serializar na resposta. */
export async function salvarInscricaoPush(s: Sessao, entrada: z.input<typeof zInscricaoPush>, origem: string, tokenAtual?: string | null) {
  const dados = zInscricaoPush.parse(entrada);
  const cfg = configuracaoPush();
  if (!cfg.disponivel) throw new ErroNegocio("Push ainda não está configurado. Use a central de avisos.", 409, "push_indisponivel");
  if (![new URL(urlSite()).origin, new URL(urlPainel()).origin].includes(origem)) throw new ErroNegocio("Origem de inscrição inválida.", 403);
  if (dados.expirationTime != null && dados.expirationTime <= Date.now()) throw new ErroNegocio("A inscrição do navegador expirou. Ative as notificações novamente.", 409);
  const endpointHash = hashPush(dados.endpoint);
  const atualHash = tokenDispositivoValido(tokenAtual) ? hashPush(tokenAtual!) : null;
  const token = randomBytes(32).toString("base64url");
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`push:inscricao:${endpointHash}`}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`push:usuario:${s.usuarioId}`}))`;
    const usuario = await tx.usuario.findUnique({ where: { id: s.usuarioId }, select: { ativo: true } });
    if (!usuario?.ativo) throw new ErroNegocio("Entre novamente para ativar o dispositivo.", 401);
    const existente = await tx.pushInscricao.findUnique({ where: { endpointHash } });
    if (existente && existente.usuarioId !== s.usuarioId) throw new ErroNegocio("Esta inscrição pertence a outra sessão. Desative as notificações deste navegador e ative novamente.", 409, "inscricao_outra_conta");
    if (!existente?.ativo && await tx.pushInscricao.count({ where: { usuarioId: s.usuarioId, ativo: true } }) >= MAX_DISPOSITIVOS) throw new ErroNegocio("Limite de dez dispositivos ativos. Desative um antes de continuar.", 409);
    if (atualHash) {
      const anterior = await tx.pushInscricao.findUnique({ where: { tokenHash: atualHash } });
      if (anterior && anterior.endpointHash !== endpointHash) {
        await tx.pushInscricao.update({ where: { id: anterior.id }, data: { ativo: false, codigoErro: "INSCRICAO_SUBSTITUIDA" } });
        await tx.pushEntrega.updateMany({ where: { inscricaoId: anterior.id, estado: "PENDENTE" }, data: { estado: "CANCELADO", codigoErro: "INSCRICAO_SUBSTITUIDA" } });
      }
    }
    const valores = { usuarioId: s.usuarioId, endpoint: dados.endpoint, p256dh: dados.keys.p256dh, auth: dados.keys.auth, tokenHash: hashPush(token), vapidHash: cfg.vapidHash, origem, nome: dados.nome, ativo: true, codigoErro: null };
    const inscricao = await tx.pushInscricao.upsert({ where: { endpointHash }, create: { endpointHash, ...valores }, update: valores });
    return { id: inscricao.id, token };
  });
}

export async function dispositivosDoUsuario(usuarioId: string, token?: string | null): Promise<DispositivoPushDto[]> {
  const hash = tokenDispositivoValido(token) ? hashPush(token!) : null;
  const rows = await db.pushInscricao.findMany({ where: { usuarioId }, orderBy: { atualizadoEm: "desc" }, take: 50, select: { id: true, nome: true, tokenHash: true, ativo: true, criadoEm: true, ultimoEnvioEm: true, codigoErro: true } });
  return rows.map((r) => ({ id: r.id, nome: r.nome, atual: r.tokenHash === hash, ativo: r.ativo, criadoEm: r.criadoEm.toISOString(), ultimoEnvioEm: r.ultimoEnvioEm?.toISOString() ?? null, codigoErro: r.codigoErro }));
}

export async function revogarInscricaoPush(usuarioId: string | null, token: string | null, id?: string, codigoErro = "DESATIVADO_PELO_USUARIO") {
  const tokenHash = tokenDispositivoValido(token) ? hashPush(token!) : null;
  if (!id && !tokenHash) return;
  await db.$transaction(async (tx) => {
    const inscricao = await tx.pushInscricao.findFirst({ where: { ...(id ? { id } : { tokenHash: tokenHash! }), ...(usuarioId ? { usuarioId } : {}) }, select: { id: true } });
    if (!inscricao) { if (id) throw naoEncontrado("Dispositivo"); return; }
    await tx.pushInscricao.update({ where: { id: inscricao.id }, data: { ativo: false, codigoErro } });
    await tx.pushEntrega.updateMany({ where: { inscricaoId: inscricao.id, estado: "PENDENTE" }, data: { estado: "CANCELADO", codigoErro } });
  });
}

/** Logout encerra somente a inscrição identificada pelo cookie deste navegador. */
export async function revogarDispositivoAtual(usuarioId?: string) {
  const token = await tokenDoDispositivo();
  await revogarInscricaoPush(usuarioId ?? null, token, undefined, "SESSAO_ENCERRADA");
  (await cookies()).delete(COOKIE_DISPOSITIVO_PUSH);
}

/** Reautenticar a mesma conta mantém a inscrição; trocar de conta revoga a anterior. */
export async function revogarAoTrocarConta(usuarioIdNovo: string) {
  const token = await tokenDoDispositivo();
  if (!token) return;
  const atual = await db.pushInscricao.findUnique({ where: { tokenHash: hashPush(token) }, select: { usuarioId: true, ativo: true } });
  if (atual?.usuarioId === usuarioIdNovo && atual.ativo) return;
  await revogarDispositivoAtual();
}
