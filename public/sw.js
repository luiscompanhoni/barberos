/* Dados de contas nunca entram no cache. Manter destinos alinhados com lib/pwa/urls.ts. */
const CACHE_PUBLICO = "black-public-v1";
const ARQUIVOS_PUBLICOS = ["/offline.html"];
const DESTINOS = new Set([
  "/c", "/painel", "/c/notificacoes", "/notificacoes", "/c/avaliacoes", "/avaliacoes",
  "/c/agendar", "/c/premios", "/meu-dia", "/minha-agenda", "/recepcao", "/reunioes", "/desempenho",
]);

function destinoNotificacao(href, area) {
  const padrao = area === "cliente" ? "/c/notificacoes" : "/notificacoes";
  if (typeof href !== "string" || href.length > 1024 || !href.startsWith("/") || href.startsWith("//") || /[\\\u0000-\u0020]/.test(href)) return padrao;
  try {
    const url = new URL(href, self.location.origin);
    if (url.origin !== self.location.origin || !DESTINOS.has(url.pathname)) return padrao;
    const busca = new URLSearchParams();
    for (const chave of ["id", "data", "barbeiroId", "servicoId", "encaixes"]) {
      const valor = url.searchParams.get(chave);
      if (valor && /^[\w-]{1,80}$/.test(valor)) busca.set(chave, valor);
    }
    return url.pathname + (busca.size ? `?${busca}` : "");
  } catch { return padrao; }
}

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_PUBLICO).then(cache => cache.addAll(ARQUIVOS_PUBLICOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("black-public-") && k !== CACHE_PUBLICO).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname === "/api" || url.pathname.startsWith("/api/") || url.pathname.startsWith("/_next/") || req.headers.has("rsc") || url.searchParams.has("_rsc")) return;
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(async () => (await caches.match("/offline.html")) ?? new Response("Sem conexão. Tente novamente quando estiver online.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })));
  } else if (ARQUIVOS_PUBLICOS.includes(url.pathname) && !url.search) {
    event.respondWith(caches.match(url.pathname).then(resposta => resposta ?? fetch(req)));
  }
});

self.addEventListener("push", event => {
  let dados = {};
  try { const lido = event.data?.json(); if (lido && typeof lido === "object") dados = lido; } catch { /* Exibir aviso genérico mesmo se o payload estiver inválido. */ }
  const area = dados.area === "cliente" || (typeof dados.href === "string" && (dados.href === "/c" || dados.href.startsWith("/c/"))) ? "cliente" : "equipe";
  const id = typeof dados.id === "string" && /^[\w-]{1,100}$/.test(dados.id) ? dados.id : "aviso";
  const href = destinoNotificacao(dados.href, area);
  event.waitUntil(self.registration.showNotification("Black Barber", {
    body: "Você tem um novo aviso. Abra o aplicativo para conferir.",
    icon: "/pwa/icon-192.png", badge: "/pwa/icon-192.png",
    tag: `black-${id}`, renotify: false,
    data: { href, area },
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const href = destinoNotificacao(event.notification.data?.href, event.notification.data?.area);
  const destino = new URL(href, self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async janelas => {
    const aberta = janelas.find(j => j.url === destino);
    if (aberta) return aberta.focus();
    return self.clients.openWindow(destino);
  }));
});
