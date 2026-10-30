const DESTINOS = new Set([
  "/c", "/painel", "/c/notificacoes", "/notificacoes", "/c/avaliacoes", "/avaliacoes",
  "/c/agendar", "/c/premios", "/meu-dia", "/minha-agenda", "/recepcao", "/reunioes", "/desempenho",
]);

/** Uma notificação nunca abre domínio externo, endpoint de API ou redirecionador. */
export function destinoNotificacao(href: unknown, area: "cliente" | "equipe" = "equipe") {
  const padrao = area === "cliente" ? "/c/notificacoes" : "/notificacoes";
  if (typeof href !== "string" || href.length > 1024 || !href.startsWith("/") || href.startsWith("//") || /[\\\u0000-\u0020]/.test(href)) return padrao;
  try {
    const url = new URL(href, "https://black.invalid");
    if (url.origin !== "https://black.invalid" || !DESTINOS.has(url.pathname)) return padrao;
    const busca = new URLSearchParams();
    for (const chave of ["id", "data", "barbeiroId", "servicoId", "encaixes"]) {
      const valor = url.searchParams.get(chave);
      if (valor && /^[\w-]{1,80}$/.test(valor)) busca.set(chave, valor);
    }
    return url.pathname + (busca.size ? `?${busca}` : "");
  } catch { return padrao; }
}
