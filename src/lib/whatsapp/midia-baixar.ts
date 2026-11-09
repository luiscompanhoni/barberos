import type { MidiaRecebida } from "./midia-tipos";

export const MAX_MIDIA_BYTES = 8 * 1024 * 1024;

/** Limita o stream, inclusive quando o servidor não informa Content-Length. */
export async function lerLimitado(r: Response, limite = MAX_MIDIA_BYTES): Promise<Buffer> {
  if (!r.ok || !r.body || Number(r.headers.get("content-length")) > limite) throw new Error("Mídia indisponível ou muito grande.");
  const reader = r.body.getReader();
  const partes: Uint8Array[] = [];
  let tamanho = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      tamanho += value.length;
      if (tamanho > limite) throw new Error("Mídia muito grande.");
      partes.push(value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(partes);
}

/** URL devolvida pela Meta, nunca o link digitado pelo cliente. Sem redirects. */
export function urlMidiaMeta(valor: string) {
  const u = new URL(valor);
  if (u.protocol !== "https:" || u.username || u.password || u.port ||
    ![".fbsbx.com", ".fbcdn.net"].some((s) => u.hostname.endsWith(s))) throw new Error("Origem de mídia inválida.");
  return u;
}

export async function baixarMidia(m: MidiaRecebida, waId: string, requisitar: typeof fetch = fetch): Promise<Buffer> {
  if (m.tamanho && m.tamanho > MAX_MIDIA_BYTES) throw new Error("Mídia muito grande.");
  if (m.segundos && m.segundos > 120) throw new Error("Áudio acima de dois minutos.");
  if (!/^[\w.:-]{1,256}$/.test(m.id)) throw new Error("Identificador de mídia inválido.");
  const signal = AbortSignal.timeout(30_000);
  if (m.provedor === "evolution") {
    const base = process.env.EVOLUTION_URL;
    const chave = process.env.EVOLUTION_API_KEY;
    if (!base || !chave) throw new Error("Evolution não configurada.");
    const instancia = encodeURIComponent(process.env.EVOLUTION_INSTANCIA || "barberos");
    const r = await requisitar(`${base.replace(/\/$/, "")}/chat/getBase64FromMediaMessage/${instancia}`, {
      method: "POST", redirect: "error", signal,
      headers: { apikey: chave, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { key: { id: m.id, remoteJid: `${waId.replace(/\D/g, "")}@s.whatsapp.net`, fromMe: false } }, convertToMp4: false }),
    });
    const json = JSON.parse((await lerLimitado(r, 12 * 1024 * 1024)).toString()) as { base64?: string };
    const b64 = json.base64?.replace(/^data:[^;,]+;base64,/, "");
    if (!b64 || !/^[A-Za-z0-9+/\r\n]*={0,2}$/.test(b64)) throw new Error("Conteúdo de mídia inválido.");
    const dados = Buffer.from(b64, "base64");
    if (!dados.length || dados.length > MAX_MIDIA_BYTES) throw new Error("Mídia vazia ou muito grande.");
    return dados;
  }
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) throw new Error("Meta não configurada.");
  const versao = process.env.WHATSAPP_API_VERSION || "v23.0";
  if (!/^v\d+\.\d+$/.test(versao)) throw new Error("Versão Meta inválida.");
  const headers = { Authorization: `Bearer ${token}` };
  const r = await requisitar(`https://graph.facebook.com/${versao}/${encodeURIComponent(m.id)}`, { headers, signal, redirect: "error" });
  const meta = JSON.parse((await lerLimitado(r, 32_768)).toString()) as { url?: string; file_size?: number };
  if (!meta.url || (meta.file_size && meta.file_size > MAX_MIDIA_BYTES)) throw new Error("Mídia indisponível ou muito grande.");
  return lerLimitado(await requisitar(urlMidiaMeta(meta.url), { headers, signal, redirect: "error" }));
}
