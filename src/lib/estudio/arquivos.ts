import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { Readable } from "node:stream";
import { ErroNegocio } from "@/lib/erros";
import { assinaturaValida, faixa } from "./regras";

export function pasta() {
  if (process.env.NODE_ENV === "production" && !process.env.ESTUDIO_STORAGE_ROOT) throw new ErroNegocio("Armazenamento do Estúdio não configurado.", 503);
  return resolve(process.env.ESTUDIO_STORAGE_ROOT || ".data/estudio");
}
export function caminho(chave: string) {
  if (!/^[a-f0-9-]{36}\.(mp4|webm|mov|part)$/.test(chave)) throw new Error("Chave de mídia inválida");
  return join(pasta(), chave);
}
export const apagar = (chave: string) => rm(caminho(chave), { force: true });
export async function receber(req: Request, esperado: number | null, maximo: number, mime: string) {
  if (!req.body) throw new ErroNegocio("Arquivo vazio.", 400);
  const length = Number(req.headers.get("content-length"));
  if (length > maximo || (esperado !== null && length > 0 && length !== esperado)) throw new ErroNegocio("Tamanho de arquivo inválido.", 413);
  await mkdir(pasta(), { recursive: true });
  const id = randomUUID();
  const temporario = id + ".part";
  const chave = id + (mime === "video/webm" ? ".webm" : mime === "video/quicktime" ? ".mov" : ".mp4");
  const f = await open(caminho(temporario), "wx");
  const leitor = req.body.getReader();
  const hash = createHash("sha256");
  let bytes = 0; let expirou = false;
  let inicio = Buffer.alloc(0);
  // Limite real durante o stream, inclusive sem Content-Length; memória limitada.
  const timeout = setTimeout(() => { expirou = true; void leitor.cancel("Tempo de envio esgotado").catch(() => {}); }, 5 * 60_000);
  try {
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximo || (esperado !== null && bytes > esperado)) throw new ErroNegocio("Arquivo acima do limite.", 413);
      if (inicio.length < 16) inicio = Buffer.concat([inicio, Buffer.from(value.slice(0, 16 - inicio.length))]);
      hash.update(value);
      let offset = 0;
      while (offset < value.length) offset += (await f.write(value, offset)).bytesWritten;
    }
    if (expirou || bytes < 32 || (esperado !== null && bytes !== esperado) || !assinaturaValida(inicio, mime)) throw new ErroNegocio("Vídeo incompleto ou formato inválido.", 400);
    await f.close();
    await rename(caminho(temporario), caminho(chave));
    return { chave, bytes, hash: hash.digest("hex") };
  } catch (e) {
    await leitor.cancel().catch(() => {});
    await f.close().catch(() => {});
    await apagar(temporario);
    throw e;
  } finally { clearTimeout(timeout); leitor.releaseLock(); }
}

export async function transmitir(req: Request, chave: string, mime: string, download = false) {
  const arquivo = caminho(chave);
  const tamanho = await stat(arquivo).then(s => s.size).catch(() => { throw new ErroNegocio("Arquivo indisponível.", 404); });
  const range = faixa(req.headers.get("range"), tamanho);
  const headers = new Headers({ "Content-Type": mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes", "Content-Disposition": (download ? "attachment" : "inline") + '; filename="black-video.' + (mime === "video/webm" ? "webm" : mime === "video/quicktime" ? "mov" : "mp4") + '"' });
  if (range === false) { headers.set("Content-Range", "bytes */" + tamanho); return new Response(null, { status: 416, headers }); }
  const inicio = range?.inicio ?? 0;
  const fim = range?.fim ?? tamanho - 1;
  headers.set("Content-Length", String(fim - inicio + 1));
  if (range) headers.set("Content-Range", "bytes " + inicio + "-" + fim + "/" + tamanho);
  const stream = createReadStream(arquivo, { start: inicio, end: fim });
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status: range ? 206 : 200, headers });
}
