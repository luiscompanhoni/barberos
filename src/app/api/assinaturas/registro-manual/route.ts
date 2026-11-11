import { NextResponse } from "next/server";
import { corpoAssinatura } from "@/lib/assinaturas/http";
import { registrarAssinaturaPaga } from "@/lib/assinaturas/registro-manual";
import { schemaRegistroManual } from "@/lib/assinaturas/schemas";
import { BALCAO, exigirSessao } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";

export const POST = rota(async (req: Request) => {
  const sessao = await exigirSessao(BALCAO);
  const entrada = await corpoAssinatura(req, schemaRegistroManual);
  const registro = await registrarAssinaturaPaga(sessao, entrada);
  return NextResponse.json(registro, { status: registro.novo ? 201 : 200 });
});
