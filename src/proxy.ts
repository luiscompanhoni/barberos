import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_SESSAO, lerToken } from "@/lib/auth/token";

/**
 * Checagem otimista: sem sessao valida, manda para o login certo (cliente em
 * /c/entrar, equipe em /entrar). A autorizacao de verdade acontece em cada rota
 * da API (exigirSessao / exigirCliente).
 */
export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (path === "/c/entrar") return NextResponse.next();
  const sessao = await lerToken(req.cookies.get(COOKIE_SESSAO)?.value);
  if (!sessao) {
    const url = new URL(path === "/c" || path.startsWith("/c/") ? "/c/entrar" : "/entrar", req.url);
    url.searchParams.set("voltar", path);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!entrar|api|_next|favicon.ico|.*\\.(?:png|svg|ico|webmanifest)).*)"],
};
