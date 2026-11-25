type Opcoes = { aoConectar?: (conectado: boolean) => void };

/** SSE imediato, com reconciliação após suspensão do celular e eventos perdidos. */
export function acompanharAgenda(atualizar: () => void, opcoes: Opcoes = {}) {
  let debounce: ReturnType<typeof setTimeout>;
  const visivel = () => document.visibilityState !== "hidden";
  const recarregar = () => { if (visivel()) atualizar(); };
  const eventos = typeof EventSource === "undefined" ? null : new EventSource("/api/eventos");
  if (eventos) {
    eventos.onopen = () => { opcoes.aoConectar?.(true); recarregar(); };
    eventos.onerror = () => opcoes.aoConectar?.(false);
    eventos.onmessage = (ev) => {
      try { if (JSON.parse(ev.data).tipo !== "agenda") return; } catch { return; }
      clearTimeout(debounce);
      debounce = setTimeout(recarregar, 250);
    };
  }
  const timer = setInterval(recarregar, 15_000);
  window.addEventListener("focus", recarregar);
  window.addEventListener("online", recarregar);
  document.addEventListener("visibilitychange", recarregar);
  return () => {
    clearTimeout(debounce);
    clearInterval(timer);
    eventos?.close();
    window.removeEventListener("focus", recarregar);
    window.removeEventListener("online", recarregar);
    document.removeEventListener("visibilitychange", recarregar);
  };
}
