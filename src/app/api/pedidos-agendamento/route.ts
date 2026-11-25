import { after, NextResponse } from "next/server";
import { enviarAvisosNovoAgendamento } from "@/lib/notificacoes/envio-agendamento";
import { z } from "zod";
import { BALCAO, exigirSessao } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { decidirPedido, listarPedidos } from "@/lib/agenda/pedidos";
import { corpoPedido } from "@/lib/agenda/pedidos-regras";
import { zId, zInstante } from "@/lib/validacao";

export const GET = rota(async () => {
  await exigirSessao(BALCAO);
  return NextResponse.json(await listarPedidos(), { headers: { "Cache-Control": "private, no-store" } });
});

const decisao = z.discriminatedUnion("acao", [
  z.object({ id: zId, acao: z.literal("recusar") }).strict(),
  z.object({ id: zId, acao: z.literal("aprovar"), barbeiroId: zId, inicio: zInstante, conferido: z.literal(true),
    precoEsperadoCentavos: z.number().int().nonnegative(), duracaoEsperadaMin: z.number().int().min(5).max(480), forcarAvulso: z.boolean().default(false),
  }).strict(),
]);

export const PATCH = rota(async (req: Request) => {
  const s = await exigirSessao(BALCAO), p = await corpoPedido(req, decisao, true);
  const resultado = await decidirPedido(p.id, s, p);
  if ("agendamentoId" in resultado) after(() => enviarAvisosNovoAgendamento(resultado.agendamentoId));
  return NextResponse.json(resultado);
});
