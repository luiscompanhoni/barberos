import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizarLogin, trocarPropriaSenha } from "@/lib/auth/acesso";
import { exigirSessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio, rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";

const TODOS = ["DONO", "GERENTE", "RECEPCAO", "BARBEIRO", "CLIENTE"] as const;

/** Situacao da conta: tem senha? precisa trocar? qual o usuario? */
export const GET = rota(async () => {
  const s = await exigirSessao([...TODOS]);
  const u = await db.usuario.findUniqueOrThrow({ where: { id: s.usuarioId }, select: { login: true, senhaHash: true, trocarSenha: true, telefone: true } });
  return NextResponse.json({ login: u.login, temSenha: !!u.senhaHash, trocarSenha: u.trocarSenha, telefone: u.telefone });
});

/** Cria/troca a propria senha e (equipe) o nome de usuario. */
export const PATCH = rota(async (req: Request) => {
  const s = await exigirSessao([...TODOS]);
  const b = await corpo(req, z.object({
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
  if (b.nova) await trocarPropriaSenha(s.usuarioId, { atual: b.atual, nova: b.nova });
  return NextResponse.json({ ok: true });
});
