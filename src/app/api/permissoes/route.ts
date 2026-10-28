import { NextResponse } from "next/server";
import { z } from "zod";
import { matrizPermissoes, salvarPermissoes } from "@/lib/auth/permissoes";
import { CHAVES, type Permissao } from "@/lib/auth/permissoes-regras";
import { exigirSessao } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";

export const dynamic = "force-dynamic";

/** Matriz de permissoes por acao (so o dono ve e muda). */
export const GET = rota(async () => {
  await exigirSessao(["DONO"]);
  return NextResponse.json(await matrizPermissoes());
});

const zPapel = z.partialRecord(z.enum(CHAVES as [Permissao, ...Permissao[]]), z.boolean());

export const PUT = rota(async (req: Request) => {
  const s = await exigirSessao(["DONO"]);
  const b = await corpo(req, z.object({ GERENTE: zPapel, LIDER: zPapel.optional(), RECEPCAO: zPapel, BARBEIRO: zPapel }));
  return NextResponse.json(await salvarPermissoes(s, b));
});
