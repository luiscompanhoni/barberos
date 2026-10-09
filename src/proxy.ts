import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_SESSAO, lerToken } from "@/lib/auth/token";
import { dominiosSeparados, ehHostPainel, ehPaginaDoSite, urlPainel, urlSite } from "@/lib/dominios";

/**
 * 1) Site x painel (quando PAINEL_URL esta configurado): cada pagina so abre no seu endereco.
 *    No site, "/" e a pagina de venda e "/entrar" e o login do cliente.
 * 2) Checagem otimista de login: sem sessao, manda para o login certo. A autorizacao de
 *    verdade acontece em cada rota da API (exigirSessao / exigirCliente).
 */
export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const busca = req.nextUrl.search;
  const separados = dominiosSeparados();

  if (separados) {
    const painel = ehHostPainel(req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
    const doSite = ehPaginaDoSite(path);
    if (painel && doSite && path !== "/" && path !== "/entrar") return NextResponse.redirect(`${urlSite()}${path}${busca}`);
    if (!painel) {
      if (!doSite) return NextResponse.redirect(`${urlPainel()}${path}${busca}`);
      if (path === "/") return NextResponse.rewrite(new URL(`/assine${busca}`, req.url));
      if (path === "/entrar") return NextResponse.rewrite(new URL(`/c/entrar${busca}`, req.url));
    }
  }

  // Logins, vitrine e paginas de pagamento (link com codigo aleatorio) sao publicos.
  const PUBLICAS = ["/c/pagamento-simulado/", "/c/pagar/", "/c/assinar/", "/c/link/", "/i/", "/t/"];
  if (path === "/entrar" || path === "/c/entrar" || path === "/assine" || PUBLICAS.some((p) => path.startsWith(p))) return NextResponse.next();
  const sessao = await lerToken(req.cookies.get(COOKIE_SESSAO)?.value);
  if (!sessao) {
    const cliente = path === "/c" || path.startsWith("/c/");
    // Com enderecos separados, monta pelo endereco configurado (req.url pode vir com o host interno do servidor).
    const base = separados ? (cliente ? urlSite() : urlPainel()) : req.url;
    const url = new URL(cliente ? (separados ? "/entrar" : "/c/entrar") : "/entrar", base);
    // Mantem a query (ex.: /c/planos?plano=... vindo da vitrine) para voltar ao mesmo lugar.
    url.searchParams.set("voltar", path + busca);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next|favicon.ico|.*\\.(?:png|jpg|svg|ico|webmanifest)).*)"],
};
