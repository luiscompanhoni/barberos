import { NextResponse } from "next/server";
import { urlSite } from "@/lib/dominios";
import { retornarSocial } from "@/lib/auth/social";
import { zProvedorSocial } from "@/lib/auth/social-provedores";
import { limitarOrigemAutenticacao } from "@/lib/auth/limites";

/** Apple usa form_post; os demais provedores devolvem query. O state substitui o CSRF de mesma origem. */
async function retorno(req: Request, ctx: RouteContext<"/api/auth/social/[provedor]/retorno">) {
  try {
    limitarOrigemAutenticacao(req);
    const { provedor } = await ctx.params;
    const p = zProvedorSocial.parse(provedor);
    if (req.method === "POST" && p !== "apple") throw new Error("Método inválido");
    let valores: URLSearchParams;
    if (req.method === "POST") {
      const leitor = req.body?.getReader();
      if (!leitor) throw new Error("Corpo ausente");
      const partes: Uint8Array[] = []; let bytes = 0;
      try { for (;;) { const r = await leitor.read(); if (r.done) break; bytes += r.value.length;
        if (bytes > 16_384) { await leitor.cancel(); throw new Error("Corpo excedido"); } partes.push(r.value); } }
      finally { leitor.releaseLock(); }
      valores = new URLSearchParams(Buffer.concat(partes).toString("utf8"));
    } else valores = new URL(req.url).searchParams;
    if (valores.has("error")) throw new Error("Acesso não autorizado");
    const destino = await retornarSocial(p, valores.get("state") ?? "", valores.get("code") ?? "");
    return NextResponse.redirect(new URL(destino, urlSite()), 303);
  } catch {
    // Código, token, dados do provedor e respostas não vão para logs ou URL.
    return NextResponse.redirect(new URL("/c/entrar?social=erro", urlSite()), 303);
  }
}
export const GET = retorno;
export const POST = retorno;
