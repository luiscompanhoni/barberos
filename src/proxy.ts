import { NextResponse, type NextRequest } from "next/server";
import { lerToken, tokenDoCookie } from "@/lib/auth/token";
import { dominiosSeparados, ehHostPainel, ehPaginaDoSite, urlPainel, urlSite } from "@/lib/dominios";

/**
 * 1) Site x painel (quando PAINEL_URL esta configurado): cada pagina so abre no seu endereco.
 *    No site, "/" é a vitrine e "/entrar" é o acesso único de todos os perfis.
 * 2) Checagem otimista de login: sem sessão, manda para o acesso único. A autorização de
 *    verdade acontece em cada rota da API (exigirSessao / exigirCliente).
 */
export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const busca = req.nextUrl.search;
  const separados = dominiosSeparados();

  if (separados) {
    const painel = ehHostPainel(req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
    if (painel && (path === "/entrar" || path === "/c/entrar")) return NextResponse.redirect(`${urlSite()}/entrar${busca}`);
    const doSite = ehPaginaDoSite(path);
    if (painel && doSite && path !== "/" && path !== "/entrar") return NextResponse.redirect(`${urlSite()}${path}${busca}`);
    if (!painel) {
      if (!doSite) return NextResponse.redirect(`${urlPainel()}${path}${busca}`);
      if (path === "/") return NextResponse.rewrite(new URL(`/assine${busca}`, req.url));
      if (path === "/entrar") return NextResponse.rewrite(new URL(`/c/entrar${busca}`, req.url));
    }
  }

  // Logins, vitrine e paginas de pagamento (link com codigo aleatorio) sao publicos.
  const PUBLICAS = ["/vagas/", "/c/pagamento-simulado/", "/c/pagar/", "/c/assinar/", "/c/link/", "/c/r/", "/i/", "/t/"];
  if (path === "/entrevistas" || path === "/entrar" || path === "/c/entrar" || path === "/assine" || path === "/privacidade" || path === "/termos" || PUBLICAS.some((p) => path.startsWith(p))) return NextResponse.next();
  const sessao = await lerToken(tokenDoCookie(req.cookies));
  if (!sessao) {
    // Com enderecos separados, monta pelo endereco configurado (req.url pode vir com o host interno do servidor).
    const base = separados ? urlSite() : req.url;
    const url = new URL("/entrar", base);
    // Mantem a query (ex.: /c/planos?plano=... vindo da vitrine) para voltar ao mesmo lugar.
    url.searchParams.set("voltar", path + busca);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next|favicon.ico|sw\\.js$|offline\\.html$|.*\\.(?:png|jpg|webp|svg|ico|webmanifest)).*)"],
};
