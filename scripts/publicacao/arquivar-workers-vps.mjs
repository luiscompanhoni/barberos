/** Uma tag por execução; a VPS só a descarrega após restauração e render no CI isolado. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, createReadStream, fsyncSync, ftruncateSync, lstatSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parametros } from "./consultar-vps.mjs";
import { cifrar } from "./cifrar-relatorio.mjs";

const shell = s => "'" + s.replace(/'/g, "'\\''") + "'";
export const LEGADO = "legado-f7968a11";
export const APP_ESPERADO = "sha256:000bf3cac4db8ce701711ebfbf3b50c7607c20602cddf9c8a4306f931e07148e";
export const ALVOS = Object.freeze({
  d833182db751a74d3ce52017f11a2824fcb6c735: { id: "sha256:4d5728f7035eb38b0cb29c752936637047f997cf0e6eb240285c956a6f13b87e", bytesImagem: 1948259798 },
  "7f8c8f2e3dc77a1ffe39e01fc4cf1c00a752dd10": { id: "sha256:412eeeb7c3f1f1f555a5420d10a55311bd6a81c5b965f5c40fc5e354104466ab", bytesImagem: 1948279454 },
  "7efefa8daf285b2b46b8bb9d8e57663c2a2b6a8a": { id: "sha256:3a226008e7aeb5897ea669d64e22b12ae3a42ba7eb5a29bcdf27668476ce1568", bytesImagem: 1948299299 },
});
const TAG_LEGADO = "barberos-video-worker:f7968a11b1892b07eaad46b659ad7c5d18bb9bd4";
const ID_LEGADO = /^sha256:32855fc2a5d7[a-f0-9]{52}$/;

export function selecionarAlvo(alvo) {
  if (alvo === LEGADO) return { tag: TAG_LEGADO, maxBytes: 2 * 1024 ** 3 };
  if (!Object.hasOwn(ALVOS, alvo)) throw new Error("Selecione exatamente um dos três alvos autorizados.");
  return { ...ALVOS[alvo], tag: "barberos-video-worker:" + alvo, maxBytes: 2_000_000_000 };
}
export function validarPreparacao(antes, alvo = LEGADO) {
  const esperado = selecionarAlvo(alvo);
  const i = antes?.imagens?.[0];
  if (!antes || !/^workers-\d+\.tar\.gz$/.test(antes.arquivo) || !/^[a-f0-9]{64}$/.test(antes.sha256) ||
    !Number.isSafeInteger(antes.bytes) || antes.bytes <= 0 || antes.bytes > esperado.maxBytes ||
    !Array.isArray(antes.imagens) || antes.imagens.length !== 1 || i?.tag !== esperado.tag ||
    (alvo === LEGADO ? !ID_LEGADO.test(i.id) : i.id !== esperado.id || i.bytesImagem !== esperado.bytesImagem ||
      antes.alvo !== alvo || antes.imagemApp !== APP_ESPERADO || antes.formato !== 2)) {
    throw new Error("Arquivo, alvo, tamanho ou identidade inesperada.");
  }
}
export function validarRestauracao(esperada, restaurada, alvo = LEGADO) {
  const alvoEsperado = selecionarAlvo(alvo);
  if (esperada.tag !== alvoEsperado.tag || (alvo === LEGADO ? !ID_LEGADO.test(esperada.id) : esperada.id !== alvoEsperado.id) ||
    restaurada?.Id !== esperada.id || !Array.isArray(restaurada.RepoTags) ||
    restaurada.RepoTags.length !== 1 || restaurada.RepoTags[0] !== esperada.tag ||
    (alvo !== LEGADO && restaurada.Size !== alvoEsperado.bytesImagem)) {
    throw new Error("Tag, tamanho ou identidade restaurada divergente.");
  }
}
// Exercita FFmpeg, Chromium, Hyperframes, áudio e formato sem iniciar o worker/consultar o app.
export const SMOKE_PROGRAMA = String.raw`
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { executar, preparar, renderizar, inspecionar } from "/worker/render.mjs";
const pasta = await mkdtemp(join(process.env.ESTUDIO_WORKER_TMP, "arquivo-smoke-"));
try {
  await preparar();
  await executar(process.env.HYPERFRAMES_FFMPEG_PATH, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-f", "lavfi", "-i", "color=c=0x394455:s=180x320:r=30:d=0.5",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=0.5", "-c:a", "aac", "-shortest",
    "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", "-f", "mp4", join(pasta, "entrada-0")]);
  const arquivo = await renderizar(pasta, { preset: "black-vertical-v1", titulo: "", chamada: "",
    clipes: [{ inicio: 0, fim: 0.5, texto: "Arquivo sintético" }] });
  const info = await inspecionar(arquivo);
  if (info.largura !== 720 || info.altura !== 1280 || !info.audio ||
      Math.abs(info.duracao - 0.5) > 0.25 || (await stat(arquivo)).size <= 0) throw Error("Render divergente.");
  console.log(JSON.stringify({ concluido: true, preset: "black-vertical-v1", ...info }));
} finally { await rm(pasta, { recursive: true, force: true }); }
`;

export function argumentosSmoke(tag) {
  return ["run", "--rm", "--network", "none", "--read-only", "--memory", "2g", "--cpus", "0.75",
    "--pids-limit", "256", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
    "--shm-size", "256m", "--tmpfs", "/worker/jobs:rw,nosuid,size=1536m,uid=1000,gid=1000,mode=0700",
    "--tmpfs", "/tmp:rw,nosuid,size=256m,mode=1777", "--tmpfs", "/home/node:rw,nosuid,size=64m,uid=1000,gid=1000",
    "--entrypoint", "node", tag, "--input-type=module", "-e", SMOKE_PROGRAMA];
}
export function validarSmoke(texto) {
  const r = JSON.parse(texto);
  if (r.concluido !== true || r.preset !== "black-vertical-v1" || r.largura !== 720 || r.altura !== 1280 ||
    r.audio !== true || !Number.isFinite(r.duracao) || Math.abs(r.duracao - 0.5) > 0.25) throw new Error("Render sintético não comprovado.");
}
export async function validarCopia(antes, arquivo, alvo, executar = execFileSync) {
  validarPreparacao(antes, alvo);
  const stat = lstatSync(arquivo);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== antes.bytes) throw new Error("Tamanho transportado divergente.");
  const hash = createHash("sha256");
  for await (const b of createReadStream(arquivo)) hash.update(b);
  if (hash.digest("hex") !== antes.sha256) throw new Error("Arquivo transportado divergente.");
  executar("docker", ["load", "--input", arquivo], { timeout: 600_000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  const i = antes.imagens[0];
  const restaurada = JSON.parse(executar("docker", ["image", "inspect", i.tag], { timeout: 30_000 }).toString())[0];
  validarRestauracao(i, restaurada, alvo);
  const smoke = executar("docker", argumentosSmoke(i.tag), { timeout: 600_000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  validarSmoke(smoke.toString());
}
export async function executarFluxo(etapas, alvo) {
  const antes = await etapas.preparar();
  validarPreparacao(antes, alvo);
  const arquivo = await etapas.transferir(antes);
  await etapas.validar(antes, arquivo);
  const r = await etapas.concluir(antes);
  if (r?.concluido !== true || r.sha256 !== antes.sha256 ||
    JSON.stringify(r.imagensArquivadas) !== JSON.stringify(antes.imagens)) throw new Error("Conclusão não comprovada.");
  return { ...r, restauracaoIsoladaValidada: true, renderSinteticoValidado: true };
}

export function comprovanteCifrado(conteudo, publica) {
  return Buffer.from(JSON.stringify(cifrar(Buffer.from(JSON.stringify(conteudo)), publica)) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await executarArquivamento();
async function executarArquivamento() {
  let privado, recibo;
  const alvo = process.env.ARQUIVAMENTO_ALVO;
  try {
    selecionarAlvo(alvo);
    if (process.env.GITHUB_ACTIONS !== "true" || process.env.RUNNER_OS !== "Linux" ||
      process.env.DOCKER_HOST || process.env.DOCKER_CONTEXT) throw new Error("A restauração exige executor Linux efêmero do CI e Docker local.");
    const p = parametros(process.env);
    const imagem = process.env.VPS_IMAGEM_ANTERIOR;
    if (!/^sha256:[a-f0-9]{64}$/.test(imagem) || (alvo !== LEGADO && imagem !== APP_ESPERADO) || !process.argv[2]) {
      throw new Error("Imagem atual ou destino divergente do inventário.");
    }
    // Valida RSA-3072 e cifra antes de criar arquivo, credencial temporária ou ação remota.
    const publica = process.env.RELATORIO_CHAVE_PUBLICA;
    const inicial = comprovanteCifrado({ concluido: false, alvo }, publica);
    recibo = openSync(process.argv[2], "wx", 0o600);
    writeFileSync(recibo, inicial);
    fsyncSync(recibo);
    privado = mkdtempSync(join(tmpdir(), "barberos-worker-archive-"));
    const chave = join(privado, "identity"), hosts = join(privado, "known_hosts");
    writeFileSync(chave, process.env.VPS_SSH_KEY.replace(/\r\n/g, "\n").trimEnd() + "\n", { mode: 0o600 });
    writeFileSync(hosts, process.env.VPS_KNOWN_HOSTS.trimEnd() + "\n", { mode: 0o600 });
    const ssh = ["-F", "none", "-T", "-p", p.porta, "-i", chave, "-o", "BatchMode=yes",
      "-o", "IdentitiesOnly=yes", "-o", "IdentityAgent=none", "-o", "StrictHostKeyChecking=yes",
      "-o", "HostKeyAlgorithms=ssh-ed25519", "-o", "GlobalKnownHostsFile=/dev/null",
      "-o", "UserKnownHostsFile=" + hosts, "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=15",
      "-o", "ServerAliveCountMax=4", p.usuario + "@" + p.host];
    const remoto = (comando, opcoes = {}) => execFileSync("ssh", [...ssh, comando], {
      timeout: 720_000, maxBuffer: 1024 * 1024, stdio: ["pipe", "pipe", "pipe"], ...opcoes,
    });
    const codigo = readFileSync(new URL("./arquivar_workers.py", import.meta.url), "utf8");
    const python = (modo, extras = []) => JSON.parse(remoto("python3 -c " + shell(codigo) + " " +
      [modo + (alvo === LEGADO ? "" : "-alvo"), p.base, p.projeto, imagem,
        ...(alvo === LEGADO ? [] : [alvo]), ...extras].map(shell).join(" ")).toString());
    const r = await executarFluxo({
      preparar: () => python("preparar"),
      transferir: antes => {
        process.stdout.write("Arquivo preservado na VPS; validando cópia e render isolado.\n");
        const arquivo = join(privado, "workers.tar.gz"), fd = openSync(arquivo, "wx", 0o600);
        try { remoto("cat -- " + shell(p.base + "/worker-archives/" + antes.arquivo), { stdio: ["ignore", fd, "pipe"] }); }
        finally { closeSync(fd); }
        return arquivo;
      },
      validar: (antes, arquivo) => validarCopia(antes, arquivo, alvo),
      concluir: antes => python("concluir", [antes.arquivo, antes.sha256]),
    }, alvo);
    const comprovante = comprovanteCifrado(r, publica);
    ftruncateSync(recibo, 0);
    writeSync(recibo, comprovante, 0, comprovante.length, 0);
    fsyncSync(recibo);
    process.stdout.write("Uma tag arquivada; cópia na VPS e demais imagens/dados preservados. Espaço liberado depende de camadas compartilhadas.\n");
  } catch {
    process.stderr.write("Arquivamento não comprovado. Não prosseguir com publicação; arquivos concluídos permanecem na VPS.\n");
    process.exitCode = 1;
  } finally {
    if (recibo !== undefined) closeSync(recibo);
    if (privado) rmSync(privado, { recursive: true, force: true });
  }
}
