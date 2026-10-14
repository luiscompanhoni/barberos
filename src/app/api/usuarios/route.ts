import { NextResponse } from "next/server";
import { z } from "zod";
import { auditar } from "@/lib/auditoria";
import { exigirSessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio, rota } from "@/lib/erros";
import { normalizarTelefone } from "@/lib/telefone";
import { corpo } from "@/lib/validacao";

/** Acessos da equipe (so o dono). */
export const GET = rota(async () => {
  const s = await exigirSessao(["DONO"]);
  const us = await db.usuario.findMany({
    where: { papel: { not: "CLIENTE" } },
    orderBy: [{ papel: "asc" }, { nome: "asc" }],
    select: { id: true, nome: true, telefone: true, papel: true, login: true, ativo: true, senhaHash: true, trocarSenha: true, bloqueadoAte: true },
  });
  return NextResponse.json(us.map(({ senhaHash, bloqueadoAte, ...u }) => ({ ...u, eu: u.id === s.usuarioId, temSenha: !!senhaHash, bloqueado: !!bloqueadoAte && bloqueadoAte > new Date() })));
});

/** Novo acesso de recepcao, gerente ou outro dono. Barbeiros sao cadastrados em "Equipe e serviços". */
export const POST = rota(async (req: Request) => {
  const s = await exigirSessao(["DONO"]);
  const b = await corpo(req, z.object({ nome: z.string().trim().min(2).max(60), telefone: z.string().max(30), papel: z.enum(["RECEPCAO", "GERENTE", "DONO"]) }));
  const telefone = normalizarTelefone(b.telefone);
  if (!telefone) throw new ErroNegocio("Telefone inválido.", 400);
  if (await db.usuario.findUnique({ where: { telefone } })) throw new ErroNegocio("Já existe um usuário com esse telefone.", 409);
  const u = await db.$transaction(async (tx) => {
    const u = await tx.usuario.create({ data: { nome: b.nome, telefone, papel: b.papel } });
    await auditar(tx, s.usuarioId, "criar", "usuario", u.id, { usuario: b.nome, papel: b.papel });
    return u;
  });
  return NextResponse.json({ id: u.id }, { status: 201 });
});
