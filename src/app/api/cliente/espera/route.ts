import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirCliente } from "@/lib/auth/sessao";
import { exigirOrigemCliente } from "@/lib/auth/http-cliente";
import { entrarNaEspera, esperasDoCliente, sairDaEspera } from "@/lib/crescimento/espera";
import { schemaEsperaHorario } from "@/lib/crescimento/espera-schemas";
import { rota } from "@/lib/erros";
import { corpo, parametros, zId } from "@/lib/validacao";

export const GET = rota(async () => {
  const s = await exigirCliente();
  return NextResponse.json(await esperasDoCliente(s.clienteId));
});

/** "Me avise se abrir horario nesse dia". */
export const POST = rota(async (req: Request) => {
  const s = await exigirCliente();
  exigirOrigemCliente(req);
  const b = await corpo(req, schemaEsperaHorario, { maxBytes: 8192, tipoJson: true });
  const e = await entrarNaEspera(s.clienteId, { ...b, origem: "SITE" },
    { clienteId: s.clienteId, titular: { usuarioId: s.usuarioId, sessaoVersao: s.sessaoVersao ?? 0 } });
  return NextResponse.json({ id: e.id }, { status: 201 });
});

export const DELETE = rota(async (req: Request) => {
  const s = await exigirCliente();
  exigirOrigemCliente(req);
  const { id } = parametros(req, z.object({ id: zId }).strict());
  await sairDaEspera(s.clienteId, id, { clienteId: s.clienteId, titular: { usuarioId: s.usuarioId, sessaoVersao: s.sessaoVersao ?? 0 } });
  return NextResponse.json({ ok: true });
});
