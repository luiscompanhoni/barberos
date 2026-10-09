import { NextResponse } from "next/server";
import { exigirSessao } from "@/lib/auth/sessao";
import { naoEncontrado, rota } from "@/lib/erros";
import { zAcaoLink } from "@/lib/links/schemas";
import { cancelarLink, enviarLink, listarLinks, sincronizarLink } from "@/lib/links/servico";
import { corpo } from "@/lib/validacao";

export const dynamic = "force-dynamic";

/** Cancelar, (re)enviar no WhatsApp ou conferir no meio de pagamento. */
export const PATCH = rota(async (req: Request, ctx: RouteContext<"/api/financeiro/links/[id]">) => {
  const s = await exigirSessao(["DONO", "RECEPCAO"]);
  const { id } = await ctx.params;
  const { acao } = await corpo(req, zAcaoLink);
  let envio = null;
  if (acao === "cancelar") await cancelarLink(s, id);
  else if (acao === "enviar") envio = await enviarLink(s, id);
  else if (!(await sincronizarLink(id))) throw naoEncontrado("Link");
  return NextResponse.json({ ok: true, envio, links: await listarLinks() });
});
