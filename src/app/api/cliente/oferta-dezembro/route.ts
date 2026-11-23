import { exigirOrigemAssinatura } from "@/lib/assinaturas/http";
import { exigirCliente } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";
import { solicitarCancelamentoDezembro } from "@/lib/oferta-dezembro/cancelamento";
import { schemaAdesaoDezembro, schemaCancelamentoDezembro } from "@/lib/oferta-dezembro/schemas";
import { aderirOfertaDezembro } from "@/lib/oferta-dezembro/servico";

const opcoes = { maxBytes: 2048, tipoJson: true };

export const POST = rota(async (req: Request) => {
  exigirOrigemAssinatura(req);
  const sessao = await exigirCliente();
  const adesao = await corpo(req, schemaAdesaoDezembro, opcoes);
  const resultado = await aderirOfertaDezembro({ ...sessao, sessaoVersao: sessao.sessaoVersao ?? 0 }, adesao);
  return Response.json(resultado, { status: resultado.repetida ? 200 : 201 });
});

export const PATCH = rota(async (req: Request) => {
  exigirOrigemAssinatura(req);
  const sessao = await exigirCliente();
  const pedido = await corpo(req, schemaCancelamentoDezembro, opcoes);
  const resultado = await solicitarCancelamentoDezembro({ ...sessao, sessaoVersao: sessao.sessaoVersao ?? 0 }, pedido.quando);
  return Response.json(resultado);
});
