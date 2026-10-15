import { NextResponse } from "next/server";
import { exigirSessaoCom } from "@/lib/auth/permissoes";
import { importarStone } from "@/lib/conciliacao/stone";
import { ErroNegocio, rota } from "@/lib/erros";

export const maxDuration = 120;

/** Sobe o extrato CSV da Stone (texto do arquivo no corpo, ate 15 MB). Linha ja importada nao duplica. */
export const POST = rota(async (req: Request) => {
  const s = await exigirSessaoCom("resultado");
  const texto = await req.text();
  if (texto.length > 15_000_000) throw new ErroNegocio("Arquivo grande demais: baixe em períodos menores.", 413, "arquivo");
  return NextResponse.json(await importarStone(s, texto));
});
