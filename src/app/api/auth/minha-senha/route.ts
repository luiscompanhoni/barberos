import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizarLogin, trocarPropriaSenha } from "@/lib/auth/acesso";
import { EQUIPE, exigirSessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio, rota } from "@/lib/erros";
import { corpoAutenticacao } from "@/lib/auth/http-cliente";
import { abrirSessao } from "@/lib/auth/abrir-sessao";

// Toda a equipe (inclusive líder) e o cliente cuidam da própria senha.
const TODOS = [...EQUIPE, "CLIENTE" as const];

/** Situacao da conta: tem senha? precisa trocar? qual o usuario? */
export const GET = rota(async () => {
  const s = await exigirSessao([...TODOS]);
  const u = await db.usuario.findUniqueOrThrow({ where: { id: s.usuarioId }, select: { login: true, senhaHash: true, trocarSenha: true, telefone: true, telefoneVerificadoEm: true } });
  return NextResponse.json({ login: u.login, temSenha: !!u.senhaHash, trocarSenha: u.trocarSenha, telefone: u.telefone, confirmarCelular: s.papel === "CLIENTE" && !u.telefoneVerificadoEm }, { headers: { "Cache-Control": "private, no-store" } });
});

/** Cria/troca a propria senha e (equipe) o nome de usuario. */
export const PATCH = rota(async (req: Request) => {
  const s = await exigirSessao([...TODOS]);
  const b = await corpoAutenticacao(req, z.object({
    atual: z.string().max(128).nullish(),
    nova: z.string().max(128).optional(),
    login: z.string().max(30).nullish(),
  }));
  if (b.login !== undefined && s.papel !== "CLIENTE") {
    const login = b.login ? normalizarLogin(b.login) : null;
    if (b.login && !login) throw new ErroNegocio("Usuário: 3 a 30 caracteres, começando por letra (letras, números, ponto ou traço).");
    if (login && (await db.usuario.findFirst({ where: { login, id: { not: s.usuarioId } } }))) throw new ErroNegocio("Esse usuário já existe.", 409);
    await db.usuario.update({ where: { id: s.usuarioId }, data: { login } });
  }
  if (b.nova) {
    const u = await trocarPropriaSenha(s.usuarioId, { atual: b.atual, nova: b.nova }, s.sessaoVersao ?? 0);
    await abrirSessao(u); // Mantém somente este navegador autenticado na versão nova.
  }
  return NextResponse.json({ ok: true });
});
