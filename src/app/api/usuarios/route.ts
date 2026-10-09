import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio, rota } from "@/lib/erros";
import { normalizarTelefone } from "@/lib/telefone";
import { corpo } from "@/lib/validacao";

/** Acessos da equipe (so o dono). */
export const GET = rota(async () => {
  await exigirSessao(["DONO"]);
  const us = await db.usuario.findMany({
    where: { papel: { not: "CLIENTE" } },
    orderBy: [{ papel: "asc" }, { nome: "asc" }],
    select: { id: true, nome: true, telefone: true, papel: true, login: true, ativo: true, senhaHash: true, trocarSenha: true, bloqueadoAte: true },
  });
  return NextResponse.json(us.map(({ senhaHash, bloqueadoAte, ...u }) => ({ ...u, temSenha: !!senhaHash, bloqueado: !!bloqueadoAte && bloqueadoAte > new Date() })));
});

/** Novo acesso da recepcao (ou outro dono). Barbeiros sao cadastrados em "Equipe e serviços". */
export const POST = rota(async (req: Request) => {
  await exigirSessao(["DONO"]);
  const b = await corpo(req, z.object({ nome: z.string().trim().min(2).max(60), telefone: z.string().max(30), papel: z.enum(["RECEPCAO", "DONO"]) }));
  const telefone = normalizarTelefone(b.telefone);
  if (!telefone) throw new ErroNegocio("Telefone inválido.", 400);
  if (await db.usuario.findUnique({ where: { telefone } })) throw new ErroNegocio("Já existe um usuário com esse telefone.", 409);
  const u = await db.usuario.create({ data: { nome: b.nome, telefone, papel: b.papel } });
  return NextResponse.json({ id: u.id }, { status: 201 });
});
