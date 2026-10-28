import { NextResponse } from "next/server";
import { exigirSessao } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";
import { configuracaoTela, salvarConfig } from "@/lib/recompras/configuracao";
import { schemaConfig } from "@/lib/recompras/schemas";

export const GET = rota(async () => NextResponse.json(await configuracaoTela(await exigirSessao(["DONO"]))));
export const PATCH = rota(async (req: Request) => NextResponse.json(await salvarConfig(await exigirSessao(["DONO"]), await corpo(req, schemaConfig))));
