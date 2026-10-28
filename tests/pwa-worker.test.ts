import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { destinoNotificacao } from "@/lib/pwa/urls";

const codigo = readFileSync("public/sw.js", "utf8");
type Evento = Record<string, unknown>;

function ambiente() {
  const listeners = new Map<string, (evento: Evento) => void>();
  const cache = { addAll: vi.fn(async () => undefined) };
  const caches = { open: vi.fn(async () => cache), keys: vi.fn(async () => ["black-public-antigo", "outro-app"]), delete: vi.fn(async () => true), match: vi.fn(async () => new Response("Página pública sem conexão")) };
  const fetch = vi.fn(async () => new Response("Resposta da rede"));
  const mostrar = vi.fn<(titulo: string, opcoes: Record<string, unknown>) => Promise<void>>().mockResolvedValue(undefined);
  const openWindow = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
  const self = { location: { origin: "https://black.test" }, registration: { showNotification: mostrar },
    clients: { claim: vi.fn(async () => undefined), matchAll: vi.fn(async () => []), openWindow },
    skipWaiting: vi.fn(async () => undefined), addEventListener: (nome: string, fn: (evento: Evento) => void) => listeners.set(nome, fn) };
  runInNewContext(codigo, { self, caches, fetch, URL, URLSearchParams, Response, Set });
  async function disparar(nome: string, propriedades: Evento = {}) {
    const promessas: Promise<unknown>[] = [];
    const responder = vi.fn((p: Promise<unknown>) => { promessas.push(p); });
    listeners.get(nome)!({ ...propriedades, waitUntil: (p: Promise<unknown>) => { promessas.push(p); }, respondWith: responder });
    const resultados = await Promise.all(promessas);
    return { responder, resultados };
  }
  return { disparar, cache, caches, fetch, mostrar, openWindow };
}

const requisicao = (path: string, extras: Evento = {}) => ({ request: { url: `https://black.test${path}`, method: "GET", mode: "navigate", headers: new Headers(), ...extras } });

describe("worker sem dados privados offline", () => {
  it("pré-carrega somente a página pública e limpa só seus caches antigos", async () => {
    const a = ambiente(); await a.disparar("install"); await a.disparar("activate");
    expect(a.cache.addAll).toHaveBeenCalledWith(["/offline.html"]);
    expect(a.caches.delete).toHaveBeenCalledExactlyOnceWith("black-public-antigo");
  });
  it("usa rede para páginas e não grava a resposta autenticada em cache", async () => {
    const a = ambiente(); const r = await a.disparar("fetch", requisicao("/painel"));
    expect(await (r.resultados[0] as Response).text()).toBe("Resposta da rede");
    expect(a.caches.open).not.toHaveBeenCalled(); expect(a.cache.addAll).not.toHaveBeenCalled();
  });
  it("quando offline, entrega somente fallback público", async () => {
    const a = ambiente(); a.fetch.mockRejectedValueOnce(new Error("offline"));
    const r = await a.disparar("fetch", requisicao("/c/notificacoes"));
    expect(await (r.resultados[0] as Response).text()).toBe("Página pública sem conexão");
    expect(a.caches.match).toHaveBeenCalledExactlyOnceWith("/offline.html");
  });
  it("não intercepta POST, APIs, RSC, assets Next ou outra origem", async () => {
    const a = ambiente();
    for (const q of [requisicao("/painel", { method: "POST" }), requisicao("/api/notificacoes"), requisicao("/api"), requisicao("/painel?_rsc=123"), requisicao("/painel", { headers: new Headers({ rsc: "1" }) }), requisicao("/_next/static/chunk.js"), requisicao("/", { url: "https://evil.test" })]) {
      expect((await a.disparar("fetch", q)).responder).not.toHaveBeenCalled();
    }
    expect(a.fetch).not.toHaveBeenCalled(); expect(a.caches.match).not.toHaveBeenCalled();
  });
});

describe("push e clique seguro", () => {
  it("mantém aviso genérico e tag estável, mesmo com texto sensível no payload", async () => {
    const a = ambiente();
    await a.disparar("push", { data: { json: () => ({ id: "aviso-1", href: "/c/avaliacoes", title: "Nome do cliente", body: "Nota privada" }) } });
    expect(a.mostrar).toHaveBeenCalledWith("Black Barber", expect.objectContaining({ tag: "black-aviso-1", body: "Você tem um novo aviso. Abra o aplicativo para conferir.", renotify: false }));
    expect(JSON.stringify(a.mostrar.mock.calls)).not.toContain("Nota privada");
  });
  it("tolera payload nulo ou inválido", async () => {
    const a = ambiente(); await a.disparar("push", { data: { json: () => null } });
    await a.disparar("push", { data: { json: () => { throw new Error("json inválido"); } } });
    expect(a.mostrar).toHaveBeenCalledTimes(2);
  });
  it.each(["//evil.test", "/\\evil.test", "https://evil.test", "/api/auth/sair", "/meu-dia?data=2026-10-28&voltar=https://evil.test", "/c/avaliacoes"])("worker e interface validam destino da mesma forma: %s", async href => {
    const a = ambiente();
    await a.disparar("push", { data: { json: () => ({ id: "1", href }) } });
    const area = href.startsWith("/c/") ? "cliente" : "equipe";
    expect(a.mostrar.mock.calls[0][1].data).toEqual({ href: destinoNotificacao(href, area), area });
    await a.disparar("notificationclick", { notification: { close: vi.fn(), data: { href, area } } });
    expect(a.openWindow).toHaveBeenCalledWith(`https://black.test${destinoNotificacao(href, area)}`);
  });
});
