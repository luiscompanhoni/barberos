import { NextResponse } from "next/server";
import { exigirCliente } from "@/lib/auth/sessao";
import { conviteDoCliente } from "@/lib/avaliacoes/convites";
import { responderAvaliacao, schemaResposta } from "@/lib/avaliacoes/respostas";
import { rota } from "@/lib/erros";
import { limitar } from "@/lib/limite";
import { corpo } from "@/lib/validacao";

export const dynamic = "force-dynamic";

export const GET = rota(async () => {
  const s = await exigirCliente();
  return NextResponse.json({ convite: await conviteDoCliente(s.clienteId) }, { headers: { "Cache-Control": "private, no-store" } });
});

export const POST = rota(async (req: Request) => {
  const s = await exigirCliente();
  limitar(`avaliacao:${s.clienteId}`, 15, 60_000);
  return NextResponse.json(await responderAvaliacao(s.clienteId, await corpo(req, schemaResposta)));
});
