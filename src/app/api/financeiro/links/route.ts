import { NextResponse } from "next/server";
import { exigirSessao } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { zNovoLink } from "@/lib/links/schemas";
import { criarLink, listarLinks } from "@/lib/links/servico";
import { corpo } from "@/lib/validacao";

export const dynamic = "force-dynamic";

/** Links de pagamento (em aberto + ultimos 60 dias). ?comanda=<id> filtra os de uma comanda. */
export const GET = rota(async (req: Request) => {
  await exigirSessao(["DONO", "RECEPCAO"]);
  const comandaId = new URL(req.url).searchParams.get("comanda") ?? undefined;
  return NextResponse.json({ links: await listarLinks({ comandaId }) });
});

/** Cria o link (e manda no WhatsApp se pedir). */
export const POST = rota(async (req: Request) => {
  const s = await exigirSessao(["DONO", "RECEPCAO"]);
  const b = await corpo(req, zNovoLink);
  return NextResponse.json(await criarLink(s, b), { status: 201 });
});
