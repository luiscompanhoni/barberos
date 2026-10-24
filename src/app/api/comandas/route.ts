import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { modoMaquininha } from "@/lib/comandas/maquininha";
import { abrirComanda, listarComandas, atendimentosSemComanda } from "@/lib/comandas/servico";
import { configuracao, limitesDoDia } from "@/lib/agenda/carregar";
import { dataLocal } from "@/lib/agenda/tempo";
import { rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";

/** Abertas + histórico do dia no fuso da barbearia, incluindo cortes sem comanda. */
export const GET = rota(async () => {
  await exigirSessao();
  const cfg = await configuracao();
  const desde = new Date(limitesDoDia(dataLocal(Date.now(), cfg.fuso), cfg.fuso).inicio);
  const [comandas, concluidos] = await Promise.all([listarComandas(desde), atendimentosSemComanda(desde)]);
  return NextResponse.json({ comandas, concluidos, maquininha: modoMaquininha() });
});

export const POST = rota(async (req: Request) => {
  const s = await exigirSessao();
  const b = await corpo(
    req,
    z.object({
      clienteId: z.string().min(1).nullish(),
      nomeAvulso: z.string().trim().max(60).nullish(),
      agendamentoId: z.string().min(1).nullish(),
    }),
  );
  const r = await abrirComanda(s, b);
  return NextResponse.json(r, { status: r.nova ? 201 : 200 });
});
