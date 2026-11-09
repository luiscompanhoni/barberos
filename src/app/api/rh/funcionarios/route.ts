import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessaoCom } from "@/lib/auth/permissoes";
import { exigirSessao } from "@/lib/auth/sessao";
import { ErroNegocio, rota } from "@/lib/erros";
import { urlPainel } from "@/lib/dominios";
import { listarFuncionarios, salvarFicha } from "@/lib/rh/funcionarios";
import { criarPessoaRh, zPessoaRh } from "@/lib/rh/cadastro";
import { corpo, zData, zId } from "@/lib/validacao";

export const dynamic = "force-dynamic";

/** Fichas dos funcionarios (so o dono: tem salario e Pix). */
export const GET = rota(async () => {
  await exigirSessaoCom("folha");
  return NextResponse.json(await listarFuncionarios());
});

/** Inclusão exclusiva do dono; não cria acesso ou participação no checklist. */
export const POST = rota(async (req: Request) => {
  const s = await exigirSessao(["DONO"]);
  const origin = req.headers.get("origin");
  if (req.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== new URL(urlPainel()).origin)) throw new ErroNegocio("Origem da solicitação inválida.", 403);
  return NextResponse.json(await criarPessoaRh(s, await corpo(req, zPessoaRh, { tipoJson: true, maxBytes: 16_384 })), { status: 201, headers: { "Cache-Control": "private, no-store" } });
});

export const PATCH = rota(async (req: Request) => {
  const s = await exigirSessaoCom("folha");
  const b = await corpo(req, z.object({
    id: zId,
    cargo: z.string().trim().max(60).nullable(),
    salarioCentavos: z.number().int().min(0).max(100_000_000),
    competenciaSalario: z.string().regex(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/).optional(),
    chavePix: z.string().trim().min(1).max(120).nullable().optional(),
    revisaoPix: z.number().int().nonnegative().optional(),
    admissao: zData.nullable(),
    barbeiroId: zId.nullable(),
  }));
  const { id, ...ficha } = b;
  await salvarFicha(s, id, ficha);
  return NextResponse.json(await listarFuncionarios());
});
