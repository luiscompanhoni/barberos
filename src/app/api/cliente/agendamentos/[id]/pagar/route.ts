import { NextResponse } from "next/server";
import { z } from "zod";
import { antecipadoDoHorario, checkoutDoHorario, pagarAntecipado } from "@/lib/agenda/antecipado";
import { exigirCliente } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { limitarTentativas, zCartaoToken } from "@/lib/pagamentos/checkout";
import { corpo } from "@/lib/validacao";

/** Situacao do pagamento antecipado do horario (consulta o meio de pagamento: serve de "ja paguei"). */
// ?rapido=1 (polling do checkout): so le o banco, sem consultar o meio de pagamento.
export const GET = rota(async (req: Request, ctx: RouteContext<"/api/cliente/agendamentos/[id]/pagar">) => {
  const s = await exigirCliente();
  const { id } = await ctx.params;
  if (new URL(req.url).searchParams.get("rapido") === "1") return NextResponse.json({ checkout: await checkoutDoHorario(s.clienteId, id, false) });
  const pagamento = await antecipadoDoHorario(s.clienteId, id); // ja sincroniza
  return NextResponse.json({ pagamento, checkout: await checkoutDoHorario(s.clienteId, id, false) });
});

/** Gera o Pix / link para pagar o horario agora, ou cobra o cartao tokenizado no checkout. */
export const POST = rota(async (req: Request, ctx: RouteContext<"/api/cliente/agendamentos/[id]/pagar">) => {
  const s = await exigirCliente();
  const { id } = await ctx.params;
  const b = await corpo(req, z.object({
    forma: z.enum(["PIX", "CARTAO"]),
    cpf: z.string().max(20).optional(),
    email: z.string().trim().max(120).optional(),
    cartaoToken: zCartaoToken.optional(),
  }));
  if (b.cartaoToken) limitarTentativas(`horario:${id}`);
  const pagamento = await pagarAntecipado({ clienteId: s.clienteId, agendamentoId: id, ...b });
  return NextResponse.json({ pagamento, checkout: await checkoutDoHorario(s.clienteId, id, false) }, { status: 201 });
});
