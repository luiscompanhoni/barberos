/** Retorno do login aceita somente um caminho local, inclusive após normalização da URL. */
export function destinoAposLogin(voltar: string, padrao: string) {
  const invalido = (v: string) => !v.startsWith("/") || v.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(v);
  if (invalido(voltar)) return padrao;
  try {
    const origem = "https://barberos.invalid";
    const url = new URL(voltar, origem);
    if (url.origin !== origem || invalido(url.pathname) || invalido(decodeURIComponent(url.pathname))) return padrao;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return padrao; }
}

/** Retornos de outra área não se sobrepõem ao perfil autenticado. */
export function destinoDoPerfil(papel: string, voltar: string) {
  const cliente = papel === "CLIENTE";
  const padrao = cliente ? "/c" : papel === "BARBEIRO" || papel === "LIDER" ? "/minha-agenda" : papel === "RECEPCAO" ? "/recepcao" : "/painel";
  const destino = destinoAposLogin(voltar, padrao);
  const path = destino.split(/[?#]/)[0];
  const privado = path === "/c" || path.startsWith("/c/");
  if (path === "/" || path === "/entrar" || path === "/c/entrar" || path.startsWith("/api/") || privado !== cliente) return padrao;
  return destino;
}
