/** Render real com mídia sintética. Em container, usa os limites do Compose. */
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { executar, preparar, renderizar, inspecionar } from "../render.mjs";
import templates from "../templates.json" with { type: "json" };

const pasta = await mkdtemp(join(process.env.ESTUDIO_WORKER_TMP, "black-smoke-"));
try {
  await preparar();
  for (const [preset, t] of Object.entries(templates)) {
    const job = join(pasta, preset); await mkdir(job);
    for (const i of [0, 1]) await executar(process.env.HYPERFRAMES_FFMPEG_PATH, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y",
      "-f", "lavfi", "-i", `color=c=${i ? "0x394455" : "0x463c30"}:s=180x320:r=30:d=1.2`,
      ...(i ? [] : ["-f", "lavfi", "-i", "sine=frequency=440:duration=1.2", "-c:a", "aac", "-shortest"]),
      "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", "-f", "mp4", join(job, `entrada-${i}`)]);
    const inicio = Date.now();
    const file = await renderizar(job, { preset, titulo: t.titulo, chamada: t.chamada, clipes: [
      { inicio: 0, fim: 1.2, texto: "Um novo capítulo na Black." }, { inicio: 0.2, fim: 0.3, texto: "Imagem sintética · teste local" },
    ] });
    console.log(JSON.stringify({ preset, ...(await inspecionar(file)), tempoMs: Date.now() - inicio }));
    if (process.env.ESTUDIO_SMOKE_PRESERVAR === "true") await executar(process.env.HYPERFRAMES_FFMPEG_PATH, ["-hide_banner", "-loglevel", "error", "-y", "-ss", "0.6", "-i", file, "-frames:v", "1", join(job, "quadro.png")]);
  }
  console.log("Render sintético conferido: quatro templates, dimensões, cortes, duração e áudio.");
} finally {
  if (process.env.ESTUDIO_SMOKE_PRESERVAR === "true") console.log("Evidências locais: " + pasta);
  else await rm(pasta, { recursive: true, force: true });
}
