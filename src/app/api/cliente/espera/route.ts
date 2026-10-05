import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirCliente } from "@/lib/auth/sessao";
import { entrarNaEspera, esperasDoCliente, sairDaEspera } from "@/lib/crescimento/espera";
import { rota } from "@/lib/erros";
import { corpo, parametros, zData } from "@/lib/validacao";

export const GET = rota(async () => {
  const s = await exigirCliente();
  return NextResponse.json(await esperasDoCliente(s.clienteId));
});

/** "Me avise se abrir horario nesse dia". */
export const POST = rota(async (req: Request) => {
  const s = await exigirCliente();
  const b = await corpo(req, z.object({
    data: zData,
    servicoId: z.string().min(1),
    barbeiroId: z.string().min(1).nullish(),
    periodo: z.enum(["QUALQUER", "MANHA", "TARDE", "NOITE"]).default("QUALQUER"),
  }));
  const e = await entrarNaEspera(s.clienteId, { ...b, origem: "SITE" });
  return NextResponse.json({ id: e.id }, { status: 201 });
});

export const DELETE = rota(async (req: Request) => {
  const s = await exigirCliente();
  const { id } = parametros(req, z.object({ id: z.string().min(1) }));
  await sairDaEspera(s.clienteId, id);
  return NextResponse.json({ ok: true });
});
