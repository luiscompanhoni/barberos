import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirCliente } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { cancelarPedido, criarPedido, listarPedidos } from "@/lib/agenda/pedidos";
import { corpoPedido, entradaPedido } from "@/lib/agenda/pedidos-regras";

export const GET = rota(async () => {
  const s = await exigirCliente();
  return NextResponse.json(await listarPedidos(s.clienteId), { headers: { "Cache-Control": "private, no-store" } });
});

export const POST = rota(async (req: Request) => {
  const s = await exigirCliente(), p = await corpoPedido(req, entradaPedido);
  return NextResponse.json(await criarPedido(s.clienteId, s.usuarioId, p, s.sessaoVersao ?? 0), { status: 201 });
});

export const PATCH = rota(async (req: Request) => {
  const s = await exigirCliente();
  const p = await corpoPedido(req, z.object({ id: z.string().min(1).max(40), acao: z.literal("cancelar") }).strict());
  return NextResponse.json(await cancelarPedido(p.id, s.clienteId, s.usuarioId, s.sessaoVersao ?? 0));
});
