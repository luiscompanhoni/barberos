import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirCliente } from "@/lib/auth/sessao";
import { aceitarDesconto, cancelarPeloCliente, falarComGerente, pausar, previaCancelamento } from "@/lib/assinaturas/retencao";
import { MOTIVOS, ROTULO_MOTIVO } from "@/lib/assinaturas/retencao-regras";
import { schemaPedidoCancelamento } from "@/lib/assinaturas/schemas";
import { situacaoDoCliente } from "@/lib/assinaturas/servico";
import { ErroNegocio, rota } from "@/lib/erros";
import { corpo, parametros } from "@/lib/validacao";

async function assinaturaDoCliente(clienteId: string) {
  const sit = await situacaoDoCliente(clienteId);
  if (!sit) throw new ErroNegocio("Você não tem plano para cancelar.", 404, "sem_plano");
  return sit.assinatura.id;
}

/** Motivos e, com ?motivo=, a oferta de retencao e ate quando o plano vale se cancelar. */
export const GET = rota(async (req: Request) => {
  const s = await exigirCliente();
  const { motivo } = parametros(req, z.object({ motivo: z.enum(MOTIVOS).optional() }));
  const id = await assinaturaDoCliente(s.clienteId);
  const motivos = MOTIVOS.map((m) => ({ codigo: m, rotulo: ROTULO_MOTIVO[m] }));
  if (!motivo) return NextResponse.json({ motivos });
  return NextResponse.json({ motivos, ...(await previaCancelamento(id, motivo)) });
});

/** Decisao do cliente: aceitar desconto, pausar, falar com o gerente ou cancelar. */
export const POST = rota(async (req: Request) => {
  const s = await exigirCliente();
  const b = await corpo(req, schemaPedidoCancelamento);
  const pedido = { assinaturaId: await assinaturaDoCliente(s.clienteId), motivo: b.motivo, detalhe: b.detalhe, origem: "SITE" as const, usuarioId: s.usuarioId };
  switch (b.acao) {
    case "desconto":
      return NextResponse.json({ acao: b.acao, ...(await aceitarDesconto(pedido)) });
    case "pausa":
      if (!b.dias) throw new ErroNegocio("Escolha por quantos dias pausar.", 400, "dias");
      return NextResponse.json({ acao: b.acao, ...(await pausar({ ...pedido, dias: b.dias })) });
    case "gerente":
      return NextResponse.json({ acao: b.acao, ...(await falarComGerente(pedido)) });
    default:
      return NextResponse.json({ acao: b.acao, ...(await cancelarPeloCliente(pedido)) });
  }
});
