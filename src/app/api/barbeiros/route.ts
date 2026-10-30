import { NextResponse } from "next/server";
import { z } from "zod";
import { salvarAcesso } from "@/lib/auth/equipe";
import { exigirSessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";

export const GET = rota(async () => {
  await exigirSessao();
  const barbeiros = await db.barbeiro.findMany({
    orderBy: [{ ordem: "asc" }, { nome: "asc" }],
    select: { id: true, nome: true, cor: true, ativo: true, ordem: true, fotoVersao: true, usuario: { select: { telefone: true } } },
  });
  return NextResponse.json(barbeiros);
});

/** Cadastra barbeiro (cria o usuario de acesso com o telefone dele). So o dono, pelas regras de Acessos (auditoria e ficha). */
export const POST = rota(async (req: Request) => {
  const s = await exigirSessao(["DONO"]);
  const b = await corpo(
    req,
    z.object({
      nome: z.string().trim().min(2).max(60),
      telefone: z.string().max(30),
      cor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#378ADD"),
    }),
  );
  const { id } = await salvarAcesso(s, null, { nome: b.nome, telefone: b.telefone, papel: "BARBEIRO", atende: true, cor: b.cor });
  return NextResponse.json(await db.barbeiro.findUnique({ where: { usuarioId: id } }), { status: 201 });
});
