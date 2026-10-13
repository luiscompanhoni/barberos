import { NextResponse } from "next/server";
import { exigirSessao } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { zAlvoEstorno } from "@/lib/estornos/schemas";
import { infoAlvo } from "@/lib/estornos/servico";
import { parametros } from "@/lib/validacao";

export const dynamic = "force-dynamic";

/** O que da para estornar de um pagamento (?tipo=COMANDA&id=...). ANTECIPADO aceita o id do horario. */
export const GET = rota(async (req: Request) => {
  const s = await exigirSessao(["DONO", "RECEPCAO"]);
  const { tipo, id } = parametros(req, zAlvoEstorno);
  return NextResponse.json(await infoAlvo(s, tipo, id));
});
