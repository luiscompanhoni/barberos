import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirCliente } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";
import { dataParaTexto, zPerfilCliente } from "@/lib/validacao-cliente";

export const GET = rota(async () => {
  const s = await exigirCliente();
  const c = await db.cliente.findUniqueOrThrow({
    where: { id: s.clienteId },
    select: { nome: true, telefone: true, observacoes: true, dataNascimento: true, origem: true, origemDetalhe: true },
  });
  return NextResponse.json({ ...c, dataNascimento: dataParaTexto(c.dataNascimento) });
});

/** Nome, preferencias ("maquina 2 nas laterais"), nascimento e como conheceu. */
export const PATCH = rota(async (req: Request) => {
  const s = await exigirCliente();
  const b = await corpo(
    req,
    z.object({ nome: z.string().trim().min(2).max(60).optional(), observacoes: z.string().trim().max(300).optional() }).merge(zPerfilCliente),
  );
  const c = await db.cliente.update({ where: { id: s.clienteId }, data: b });
  if (b.nome) await db.usuario.update({ where: { id: s.usuarioId }, data: { nome: b.nome } });
  return NextResponse.json({ nome: c.nome, observacoes: c.observacoes });
});
