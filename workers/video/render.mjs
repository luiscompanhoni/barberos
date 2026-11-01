import { spawn } from "node:child_process";
import { access, mkdir, writeFile, stat } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const aqui = dirname(fileURLToPath(import.meta.url));
export const cli = join(aqui, "node_modules/hyperframes/bin/hyperframes.mjs");

export function ambienteRender() {
  const e = {};
  for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "HOME", "LANG", "HYPERFRAMES_BROWSER_PATH", "HYPERFRAMES_FFMPEG_PATH", "HYPERFRAMES_FFPROBE_PATH"]) if (process.env[key]) e[key] = process.env[key];
  return { ...e, HYPERFRAMES_NO_TELEMETRY: "1", DO_NOT_TRACK: "1", HYPERFRAMES_NO_UPDATE_CHECK: "1", HYPERFRAMES_NO_AUTO_INSTALL: "1", CI: "true" };
}
function matar(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
  else { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }
}
export function executar(bin, args, { cwd, signal, timeout = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Trabalho cancelado."));
    const child = spawn(bin, args, { cwd, env: ambienteRender(), shell: false, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; let cancelado = false;
    const cancelar = () => { cancelado = true; matar(child); };
    const timer = setTimeout(cancelar, timeout);
    signal?.addEventListener("abort", cancelar, { once: true });
    const limpar = () => { clearTimeout(timer); signal?.removeEventListener("abort", cancelar); };
    for (const stream of [child.stdout, child.stderr]) stream.on("data", d => { output = (output + d).slice(-48_000); });
    child.on("error", e => { limpar(); reject(e); });
    child.on("close", code => { limpar(); if (code === 0 && !cancelado) resolve(output); else reject(new Error(cancelado ? "Processamento interrompido." : "Processo falhou (" + code + "): " + output.slice(-4000))); });
  });
}
export async function preparar() {
  for (const key of ["HYPERFRAMES_FFMPEG_PATH", "HYPERFRAMES_FFPROBE_PATH", "HYPERFRAMES_BROWSER_PATH"]) {
    if (!process.env[key]) throw new Error("Configure " + key);
    await access(process.env[key]);
  }
  await access(cli);
  await executar(process.env.HYPERFRAMES_FFMPEG_PATH, ["-version"]);
  await executar(process.env.HYPERFRAMES_FFPROBE_PATH, ["-version"]);
}
export async function inspecionar(file, signal) {
  const text = await executar(process.env.HYPERFRAMES_FFPROBE_PATH, ["-v", "error", "-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,matroska,webm", "-show_format", "-show_streams", "-of", "json", file], { signal, timeout: 30_000 });
  const data = JSON.parse(text); const video = data.streams?.find(s => s.codec_type === "video");
  if (!video || !Number.isFinite(Number(data.format?.duration)) || Number(data.format.duration) <= 0 || video.width * video.height > 20_000_000) throw new Error("Mídia sem vídeo válido ou resolução acima do limite.");
  return { duracao: Number(data.format.duration), largura: video.width, altura: video.height, audio: data.streams.some(s => s.codec_type === "audio") };
}
export function escapar(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }
export function composicao(clipes) {
  let tempo = 0;
  const cenas = clipes.map((c, i) => {
    const inicio = tempo; tempo += c.fim - c.inicio;
    return '<video id="video-' + i + '" class="clip video" src="assets/' + i + '.mp4" data-start="' + inicio + '" data-duration="' + (c.fim - c.inicio) + '" data-track-index="0" playsinline ' + (c.audio ? 'data-has-audio="true"' : 'muted') + '></video>' + (c.texto ? '<div id="texto-' + i + '" class="clip legenda" data-start="' + inicio + '" data-duration="' + (c.fim - c.inicio) + '" data-track-index="1">' + escapar(c.texto) + '</div>' : "");
  }).join("");
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Estúdio Black</title><style>*{box-sizing:border-box}html,body{margin:0;width:720px;height:1280px;overflow:hidden;background:#101010;font-family:Arial,sans-serif}#black{position:relative;width:720px;height:1280px;overflow:hidden;background:linear-gradient(135deg,#090909,#303030,#101010)}.video{position:absolute;inset:0}video{width:100%;height:100%;object-fit:cover}.legenda{position:absolute;inset:50% 0 0;display:flex;align-items:flex-end;justify-content:center;padding:0 72px 180px;background:linear-gradient(transparent,rgba(0,0,0,.85))}.legenda{color:#fff;text-align:center;font-size:36px;font-weight:700;line-height:1.2;overflow-wrap:anywhere;white-space:pre-wrap;max-height:350px;margin:0;border-bottom:3px solid #c4a86a;padding-bottom:24px}.marca{position:absolute;top:112px;left:72px;z-index:5;color:#edd8a1;background:rgba(12,12,12,.7);border:1px solid #b99a54;padding:12px 18px;font-size:21px;letter-spacing:5px;font-weight:700}</style></head><body><div id="black" data-composition-id="black" data-width="720" data-height="1280" data-duration="' + tempo + '" data-fps="30" data-no-timeline>' + cenas + '<div class="marca">BLACK</div></div></body></html>';
}
export async function renderizar(pasta, snapshot, signal) {
  if (snapshot.preset !== "black-vertical-v1" || !Array.isArray(snapshot.clipes) || !snapshot.clipes.length || snapshot.clipes.length > 20) throw new Error("Preset inválido.");
  await mkdir(join(pasta, "assets"), { recursive: true });
  let total = 0; const clipes = [];
  for (const [i, c] of snapshot.clipes.entries()) {
    if (![c.inicio, c.fim].every(Number.isFinite) || c.inicio < 0 || c.fim - c.inicio < .1 || typeof c.texto !== "string" || c.texto.length > 100) throw new Error("Corte inválido.");
    total += c.fim - c.inicio;
    if (total > 120.001) throw new Error("Vídeo acima de 120 segundos.");
    const entrada = join(pasta, "entrada-" + i);
    const info = await inspecionar(entrada, signal);
    if (c.fim > info.duracao + 0.05) throw new Error("Corte ultrapassa a duração real do vídeo.");
    await executar(process.env.HYPERFRAMES_FFMPEG_PATH, [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-max_alloc", "268435456",
      "-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,matroska,webm", "-threads", "1",
      "-ss", String(c.inicio), "-i", entrada, "-t", String(c.fim - c.inicio), "-map", "0:v:0", "-map", "0:a:0?",
      "-vf", "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1", "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
      "-threads", "1", "-filter_threads", "1", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-ar", "48000", "-map_metadata", "-1", "-movflags", "+faststart", join(pasta, "assets", i + ".mp4")
    ], { signal, timeout: 180_000 });
    clipes.push({ ...c, audio: info.audio });
  }
  await writeFile(join(pasta, "index.html"), composicao(clipes), "utf8");
  const saida = resolve(pasta, "black.mp4");
  await executar(process.execPath, [cli, "render", pasta, "--output", saida, "--quality", "draft", "--fps", "30", "--workers", "1", "--no-browser-gpu"], { cwd: pasta, signal, timeout: 15 * 60_000 });
  const info = await inspecionar(saida, signal);
  if (info.largura !== 720 || info.altura !== 1280 || Math.abs(info.duracao - total) > .25 || (clipes.some(c => c.audio) && !info.audio) || (await stat(saida)).size > 150 * 1024 * 1024) throw new Error("Exportação fora do formato esperado.");
  return saida;
}
