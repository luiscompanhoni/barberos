import { NextResponse } from "next/server";
import { exigirCliente } from "@/lib/auth/sessao";
import { exigirOrigemCliente } from "@/lib/auth/http-cliente";
import { cancelarLembreteAgendamento, estadoLembreteAgendamento, registrarAtividadeAgendamento } from "@/lib/agenda/abandono";
import { rota } from "@/lib/erros";

export const GET = rota(async () => {
  const s = await exigirCliente();
  return NextResponse.json(await estadoLembreteAgendamento(s.clienteId));
});

export const POST = rota(async (req: Request) => {
  exigirOrigemCliente(req);
  const s = await exigirCliente();
  return NextResponse.json(await registrarAtividadeAgendamento(s.clienteId, new Date(), s.usuarioId));
});

export const DELETE = rota(async (req: Request) => {
  exigirOrigemCliente(req);
  const s = await exigirCliente();
  return NextResponse.json(await cancelarLembreteAgendamento(s.clienteId, new Date(), s.usuarioId));
});
