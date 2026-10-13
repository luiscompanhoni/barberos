/** fetch JSON do lado do navegador; lanca Error com a mensagem da API. */
export class ErroApi extends Error {
  constructor(message: string, public status: number, public codigo?: string, public detalhes?: unknown) {
    super(message);
  }
}

export async function api<T = unknown>(
  url: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<T> {
  const r = await fetch(url, {
    method: opts.method ?? "GET",
    headers: opts.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && typeof window !== "undefined") {
      window.location.replace(`/entrar?voltar=${encodeURIComponent(window.location.pathname)}`);
    }
    throw new ErroApi(json.erro ?? "Algo deu errado.", r.status, json.codigo, json.detalhes);
  }
  return json as T;
}

export const reais = (centavos: number) =>
  (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** "12,50" / "1.234,50" / "12.5" -> centavos (NaN se invalido). */
export function paraCentavos(texto: string) {
  const t = texto.trim().replace(/[R$\s]/g, "");
  const normal = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  return /^\d+(\.\d{0,2})?$/.test(normal) ? Math.round(Number(normal) * 100) : NaN;
}

/** Centavos -> "12,50" para preencher campo de valor. */
export const centavosParaTexto = (c: number) => (c / 100).toFixed(2).replace(".", ",");
