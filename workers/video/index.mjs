import { mkdtemp, open, rm, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { preparar, renderizar } from "./render.mjs";

const endpoint = new URL("/api/estudio/worker", process.env.ESTUDIO_APP_URL || "http://127.0.0.1:3000");
const token = process.env.ESTUDIO_WORKER_TOKEN || "";
if (token.length < 32) throw new Error("Configure ESTUDIO_WORKER_TOKEN com pelo menos 32 caracteres.");
if (endpoint.protocol !== "https:" && !["localhost", "127.0.0.1", "app-homolog", "app"].includes(endpoint.hostname)) throw new Error("Use HTTPS ou a rede interna do aplicativo.");
const parar = new AbortController();
process.on("SIGINT", () => parar.abort());
process.on("SIGTERM", () => parar.abort());
async function api(caminho, options = {}, signal) {
  const r = await fetch(endpoint.href + caminho, { ...options, redirect: "error", headers: { Authorization: "Bearer " + token, ...options.headers }, signal: AbortSignal.any([parar.signal, ...(signal ? [signal] : []), AbortSignal.timeout(options.body && typeof options.body !== "string" ? 300_000 : 15_000)]) });
  if (!r.ok) throw new Error("API do Estúdio: HTTP " + r.status);
  return r;
}
async function acao(body, signal) { return (await api("", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, signal)).json(); }
async function baixar(trabalho, id, destino, signal) {
  if (!/^[a-z0-9]{1,40}$/i.test(id)) throw new Error("Clipe inválido.");
  const r = await api("/" + trabalho.id + "/" + id, { headers: { "x-estudio-lease": trabalho.lease } }, signal);
  if (!r.body) throw new Error("Arquivo ausente.");
  const f = await open(destino, "wx"); let bytes = 0;
  try {
    for await (const value of r.body) {
      bytes += value.length;
      if (bytes > 100 * 1024 * 1024) throw new Error("Arquivo excede o limite.");
      let offset = 0; while (offset < value.length) offset += (await f.write(value, offset)).bytesWritten;
    }
  } finally { await f.close(); }
}
const scratch = resolve(process.env.ESTUDIO_WORKER_TMP || tmpdir());
await preparar();
console.log("Estúdio: processador pronto; um trabalho por vez.");
while (!parar.signal.aborted) {
  try {
    const { trabalho } = await acao({ acao: "claim", versao: "black-vertical-v1/hyperframes-0.8.198" });
    if (!trabalho) { await new Promise(r => { const t = setTimeout(r, 5000); parar.signal.addEventListener("abort", () => { clearTimeout(t); r(); }, { once: true, signal: AbortSignal.timeout(5100) }); }); continue; }
    if (!/^[a-z0-9]{1,40}$/i.test(trabalho.id) || !/^[a-f0-9-]{36}$/.test(trabalho.lease)) throw new Error("Trabalho inválido.");
    const dir = await mkdtemp(join(scratch, "black-render-"));
    const job = new AbortController(); const signal = AbortSignal.any([job.signal, parar.signal, AbortSignal.timeout(20 * 60_000)]);
    const heartbeat = setInterval(() => void acao({ acao: "heartbeat", id: trabalho.id, lease: trabalho.lease }, signal).catch(() => job.abort()), 15_000);
    try {
      for (const [i, c] of trabalho.snapshot.clipes.entries()) await baixar(trabalho, c.id, join(dir, "entrada-" + i), signal);
      const arquivo = await renderizar(dir, trabalho.snapshot, signal);
      await api("/" + trabalho.id, { method: "PUT", duplex: "half", headers: { "x-estudio-lease": trabalho.lease, "Content-Type": "video/mp4", "Content-Length": String((await stat(arquivo)).size) }, body: createReadStream(arquivo) }, signal);
      console.log("Estúdio: versão concluída " + trabalho.id);
    } catch (e) {
      console.error("Estúdio: falha no trabalho " + trabalho.id + ": " + e.message);
      if (!parar.signal.aborted) await acao({ acao: "falhar", id: trabalho.id, lease: trabalho.lease }).catch(() => {});
    } finally {
      clearInterval(heartbeat);
      if (!resolve(dir).startsWith(scratch + sep) || !resolve(dir).slice(scratch.length + 1).startsWith("black-render-")) throw new Error("Diretório temporário fora da área permitida.");
      await rm(dir, { recursive: true, force: true });
    }
  } catch (e) {
    if (!parar.signal.aborted) { console.error(e.message); await new Promise(r => setTimeout(r, 5000)); }
  }
}
