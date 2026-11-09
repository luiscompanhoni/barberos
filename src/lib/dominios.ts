/**
 * Dois enderecos, um sistema:
 * - SITE_URL   (ex.: https://blackbarber.com.br): pagina de venda, area do cliente e links de pagamento;
 * - PAINEL_URL (ex.: https://painel.blackbarber.com.br): sistema da equipe.
 * Sem PAINEL_URL tudo fica num endereco so (como antes). APP_URL continua valendo como padrao.
 * No computador: use o mesmo endereço localhost nos dois campos para o acesso único.
 */
const semBarra = (u: string) => u.replace(/\/$/, "");
const padrao = () => semBarra(process.env.APP_URL || "http://localhost:3000");

export const urlSite = () => semBarra(process.env.SITE_URL || padrao()); // vazio no .env = nao definido
export const urlPainel = () => semBarra(process.env.PAINEL_URL || padrao());

/** Site e painel em enderecos diferentes? */
export const dominiosSeparados = () => new URL(urlSite()).host !== new URL(urlPainel()).host;

/** O host da requisicao e o do painel? (ex.: "painel.blackbarber.com.br") */
export function ehHostPainel(host: string | null) {
  if (!dominiosSeparados() || !host) return false;
  return host.toLowerCase() === new URL(urlPainel()).host.toLowerCase();
}

/** Paginas que moram no site (cliente): o resto e do painel. */
export function ehPaginaDoSite(path: string) {
  return path === "/entrevistas" || path === "/" || path === "/assine" || path === "/entrar" || path === "/c" || path.startsWith("/c/") || path.startsWith("/i/") || path.startsWith("/vagas/") || path === "/privacidade" || path === "/termos";
}

/**
 * Cookie "Secure" so quando o sistema e servido por https (o navegador descarta cookie
 * Secure em http, e o login parece nao funcionar). Com o dominio + https, vira seguro sozinho.
 */
export const cookieSeguro = () => urlSite().startsWith("https://") && urlPainel().startsWith("https://");

/** Compartilha só o domínio explicitamente configurado, nunca um sufixo inferido. */
export function dominioDaSessao() {
  const site = new URL(urlSite()).hostname;
  const painel = new URL(urlPainel()).hostname;
  if (!cookieSeguro() || site === painel || !site.includes(".") || /^\d+\./.test(site)) return undefined;
  return painel.endsWith(`.${site}`) ? site : undefined;
}

/** Cookies não atravessam domínios independentes; portas distintas no mesmo host são compatíveis. */
export function acessoUnicoCompativel() {
  const site = new URL(urlSite()), painel = new URL(urlPainel());
  return (site.hostname === painel.hostname && site.protocol === painel.protocol) || !!dominioDaSessao();
}
