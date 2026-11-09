import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirCliente } from "@/lib/auth/sessao";
import { corpoAssinatura } from "@/lib/assinaturas/http";
import { extratoReservasCredito, reservarCreditoAssinatura } from "@/lib/crescimento/credito-assinatura";
import { rota } from "@/lib/erros";

export const GET = rota(async () => {
  const sessao = await exigirCliente();
  return NextResponse.json(await extratoReservasCredito(sessao.clienteId), { headers: { "Cache-Control": "private, no-store" } });
});

export const POST = rota(async (req: Request) => {
  const sessao = await exigirCliente();
  const entrada = await corpoAssinatura(req, z.object({ assinaturaId: z.string().min(1).max(80), valorCentavos: z.number().int().positive().max(2_147_483_647).optional() }).strict());
  return NextResponse.json(await reservarCreditoAssinatura(sessao.clienteId, entrada.assinaturaId, entrada.valorCentavos), { headers: { "Cache-Control": "private, no-store" } });
});
