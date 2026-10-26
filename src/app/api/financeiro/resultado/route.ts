import { NextResponse } from "next/server";
import { exigirSessaoCom } from "@/lib/auth/permissoes";
import { resultadoDoMes } from "@/lib/conciliacao/resultado";
import { rota } from "@/lib/erros";
import { zMes } from "@/lib/financeiro/schemas";

export const dynamic = "force-dynamic";

/** Resultado do mes (?mes=AAAA-MM): registrado x Celcash, taxas, saidas e lucro. So quem ve o lucro. */
export const GET = rota(async (req: Request) => {
  await exigirSessaoCom("lucro");
  const mes = zMes.parse(new URL(req.url).searchParams.get("mes"));
  return NextResponse.json(await resultadoDoMes(mes));
});
