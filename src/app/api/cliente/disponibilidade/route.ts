import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirCliente } from "@/lib/auth/sessao";
import { configuracao } from "@/lib/agenda/carregar";
import { horariosDisponiveis } from "@/lib/agenda/consultas";
import { dataLocal, somarDias } from "@/lib/agenda/tempo";
import { rota } from "@/lib/erros";
import { parametros, zData, zId } from "@/lib/validacao";

export const GET = rota(async (req: Request) => {
  await exigirCliente();
  const q = parametros(req, z.object({ data: zData, servicoId: zId, barbeiroId: zId.optional() }));
  const cfg = await configuracao();
  const hoje = dataLocal(Date.now(), cfg.fuso);
  if (q.data < hoje || q.data > somarDias(hoje, cfg.janelaAgendamentoDias)) return NextResponse.json([]);
  return NextResponse.json(await horariosDisponiveis({ ...q, paraCliente: true }));
});
