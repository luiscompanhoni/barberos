import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessaoCom } from "@/lib/auth/permissoes";
import { movimentosDoMes } from "@/lib/conciliacao/resultado";
import { rota } from "@/lib/erros";
import { zMes } from "@/lib/financeiro/schemas";

export const dynamic = "force-dynamic";

const zTipo = z.enum(["RECEBIMENTO", "TAXA", "ANTECIPACAO", "ESTORNO", "TRANSFERENCIA", "PAGAMENTO", "TARIFA", "OUTRO"]);

/** Movimentos do extrato externo no mes (?mes=AAAA-MM&tipo=PAGAMENTO). */
export const GET = rota(async (req: Request) => {
  await exigirSessaoCom("resultado");
  const q = new URL(req.url).searchParams;
  return NextResponse.json(await movimentosDoMes(zMes.parse(q.get("mes")), q.get("tipo") ? zTipo.parse(q.get("tipo")) : undefined));
});
