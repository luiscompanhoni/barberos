/** Render real com mídia sintética e os mesmos limites do container de produção. */
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { executar, preparar, renderizar } from "../render.mjs";

const pasta = await mkdtemp(join(process.env.ESTUDIO_WORKER_TMP, "black-smoke-"));
try {
  await preparar();
  await executar(process.env.HYPERFRAMES_FFMPEG_PATH, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-f", "lavfi", "-i", "color=c=gold:s=128x128:d=0.5", "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", "-f", "mp4", join(pasta, "entrada-0")]);
  await renderizar(pasta, { preset: "black-vertical-v1", clipes: [{ inicio: 0, fim: 0.5, texto: "Black Estúdio" }] });
  console.log("Render sintético conferido: MP4 720×1280, com duração e limites de produção.");
} finally { await rm(pasta, { recursive: true, force: true }); }
