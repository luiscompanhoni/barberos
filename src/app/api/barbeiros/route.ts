import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio, rota } from "@/lib/erros";
import { normalizarTelefone } from "@/lib/telefone";
import { corpo } from "@/lib/validacao";

export const GET = rota(async () => {
  await exigirSessao();
  const barbeiros = await db.barbeiro.findMany({
    orderBy: [{ ordem: "asc" }, { nome: "asc" }],
    select: { id: true, nome: true, cor: true, ativo: true, ordem: true, usuario: { select: { telefone: true } } },
  });
  return NextResponse.json(barbeiros);
});

/** Cadastra barbeiro (cria o usuario de acesso com o telefone dele). So o dono. */
export const POST = rota(async (req: Request) => {
  await exigirSessao(["DONO"]);
  const b = await corpo(
    req,
    z.object({
      nome: z.string().trim().min(2).max(60),
      telefone: z.string().max(30),
      cor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#378ADD"),
    }),
  );
  const telefone = normalizarTelefone(b.telefone);
  if (!telefone) throw new ErroNegocio("Telefone inválido.", 400);
  if (await db.usuario.findUnique({ where: { telefone } })) {
    throw new ErroNegocio("Já existe um usuário com esse telefone.", 409);
  }
  const total = await db.barbeiro.count();
  const barbeiro = await db.barbeiro.create({
    data: {
      nome: b.nome,
      cor: b.cor,
      ordem: total,
      usuario: { create: { telefone, nome: b.nome, papel: "BARBEIRO" } },
    },
  });
  return NextResponse.json(barbeiro, { status: 201 });
});
