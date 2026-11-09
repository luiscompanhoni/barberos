import { NextResponse } from "next/server";
import { exigirSessao, LIDERANCA } from "@/lib/auth/sessao";
import { exigirPermissao } from "@/lib/auth/permissoes";
import { calcularMetasCrescimento } from "@/lib/crescimento/metas";
import { consultarBaseMetas, zEntradaMetas } from "@/lib/crescimento/metas-consulta";
import { ErroNegocio, rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";

export const dynamic = "force-dynamic";
async function autorizar() {
  const sessao = await exigirSessao(LIDERANCA);
  await exigirPermissao(sessao, "lucro");
}
export const GET = rota(async () => {
  await autorizar();
  return NextResponse.json(await consultarBaseMetas(), { headers: { "Cache-Control": "no-store" } });
});
export const POST = rota(async (req: Request) => {
  await autorizar();
  const entrada = await corpo(req, zEntradaMetas);
  try {
    return NextResponse.json(calcularMetasCrescimento(entrada), { headers: { "Cache-Control": "no-store" } });
  } catch (erro) {
    if (erro instanceof RangeError || (erro instanceof Error && erro.message.startsWith("Data inválida"))) {
      throw new ErroNegocio("Confira datas, contagens e valores do cenário; não foi aprovado nenhum orçamento.", 400, "cenario_invalido");
    }
    throw erro;
  }
});
