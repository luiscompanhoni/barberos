/** Arquivamento nominal de um app legado; não publica, migra ou inicia o aplicativo. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, fsyncSync, ftruncateSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parametros } from "./consultar-vps.mjs";
import { comprovanteCifrado, APP_ESPERADO } from "./arquivar-workers-vps.mjs";
import { conferirArquivo, extrairMetadados, validarManifesto } from "./transferir-arquivos-workers.mjs";

export { APP_ESPERADO };
export const BRANCH = "main";
export const ALVO = "homolog-20261021";
export const TAG = "barberos-homolog:20261021";
export const ID = "sha256:2e71004d73bcdde1ca47aea01fab0a1c35df4ed226f84d3723a1fdaf62a6b2ba";
export const BYTES_IMAGEM = 716125086;
export const CANONICO_SHA256 = "d355f9472f75ecf1c79584a7350572c20f22dd9db77564e163d1b13735c14897";
export const ROOTFS = Object.freeze([
  "74d97c428c51a828f9051a7a40a53ff1fc99e54fc30323ce36760701b0b7f711", "72d3e05b9e525a1d24a2a9057bae2b276808e1d90f21db67fe3cf34fb1bf996a",
  "caefa24f31f0207dfdc7520d2a1510e7aadf2bc8ca4d25a67e6c6e1e02ab49d4", "690c35962e578d7b806464405458ec5c4a70ba26481c7759f049881d853f23cd",
  "e84858d43ea9dff1741c815c3c3ce18315c7d60ccf24087ea244a9bc2fc7e014", "e5eff1159dbdccc3db88f6263864ebf2c1167b0f3b3fa299bf119e28fac1696f",
  "810934d2ffb10d6451510c588ec0af332ac289ad39f3356098fae9f2b132a449", "e542f8918c8887aeb425fc2e2c2e5a5633f1112e3db3576bd8e204a79a34cf82",
  "fdf77ff1fe777817cfdee9f07607c77d267839b710918103f42380607e0d71de", "c22bd5cc42ff5f118e0f077ddfe99db8836225a86b46a1b6e6b3663a56654642",
  "34f9ace291acf4e1f77f2687e896e31e8ce62647ff14685b1c145cedec63f106", "d6853cbac6c84d1941af088bb853111827718c9d25b2c6c2029d94bff6415f1b",
  "e45d47a4cf239b3f1cddec3c7b133fdc950be5d6979505c11666198605404e72",
].map(s => "sha256:" + s));
const shell = s => "'" + s.replace(/'/g, "'\\''") + "'";
const imagemEsperada = () => ({ tag: TAG, id: ID, bytesImagem: BYTES_IMAGEM });

export function validarCi(runs, env) {
  if (env.GITHUB_REF !== "refs/heads/" + BRANCH || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || "") ||
      !Array.isArray(runs) || !runs.some(r => r.headSha === env.GITHUB_SHA && r.headBranch === BRANCH &&
        r.event === "push" && r.status === "completed" && r.conclusion === "success")) {
    throw Error("CI push do commit exato da main não aprovado.");
  }
}
export function validarPreparacao(r) {
  if (r?.formato !== 2 || r.alvo !== ALVO || r.imagemApp !== APP_ESPERADO ||
      !/^workers-\d+\.tar\.gz$/.test(r.arquivo) || !/^[a-f0-9]{64}$/.test(r.sha256) ||
      !Number.isSafeInteger(r.bytes) || r.bytes <= 0 || r.bytes > 2_000_000_000 ||
      JSON.stringify(r.imagens) !== JSON.stringify([imagemEsperada()])) throw Error("Preparação nominal divergente.");
}
// Só lê arquivos e verifica sintaxe: não executa Next, Prisma, migrations ou entrypoint do app.
export const SMOKE_PROGRAMA = String.raw`
const fs = require("node:fs"), { spawnSync } = require("node:child_process");
if (!process.getuid() || !process.getgid()) throw Error("Usuário privilegiado.");
if (!fs.statSync("/app/server.js").isFile()) throw Error("Servidor compilado ausente.");
const sintaxe = spawnSync(process.execPath, ["--check", "/app/server.js"], {
  encoding: "utf8", timeout: 30000, env: { PATH: "/usr/local/bin:/usr/bin:/bin" }, stdio: "pipe"
});
if (sintaxe.status !== 0 || sintaxe.error) throw Error("Sintaxe do servidor inválida.");
const p = JSON.parse(fs.readFileSync("/app/package.json", "utf8"));
if (!p || typeof p.name !== "string") throw Error("Pacote do app ausente.");
for (const nome of ["next", "react"]) {
  const arquivo = require.resolve(nome + "/package.json", { paths: ["/app"] });
  if (typeof JSON.parse(fs.readFileSync(arquivo, "utf8")).version !== "string") throw Error("Pacote inválido.");
}
console.log(JSON.stringify({ concluido: true, sintaxeServidorValidada: true, pacotesValidados: ["next", "react"], uid: process.getuid(), gid: process.getgid() }));
`;
export function argumentosSmoke() {
  return ["run", "--rm", "--pull=never", "--no-healthcheck", "--network", "none", "--user", "1000:1000", "--read-only", "--memory", "512m", "--cpus", "0.5",
    "--pids-limit", "64", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--entrypoint", "node",
    TAG, "-e", SMOKE_PROGRAMA];
}
export function validarSmoke(texto) {
  const r = JSON.parse(texto);
  if (r.concluido !== true || r.sintaxeServidorValidada !== true || r.uid !== 1000 || r.gid !== 1000 ||
      JSON.stringify(r.pacotesValidados) !== JSON.stringify(["next", "react"])) throw Error("App isolado não comprovado.");
}
export async function validarCopia(antes, arquivo, executar = execFileSync, conferir = conferirArquivo, extrair = extrairMetadados, manifestar = validarManifesto) {
  let etapa = "arquivo";
  try {
    validarPreparacao(antes);
    await conferir(arquivo, antes);
    etapa = "metadados";
    const metadados = extrair(arquivo, executar);
    const manifesto = JSON.parse(Buffer.from(metadados["manifest.json"].base64, "base64").toString());
    const [imagem] = manifestar(manifesto, antes, metadados);
    if (JSON.stringify(imagem.diffIds) !== JSON.stringify(ROOTFS)) throw Error("RootFS nominal divergente.");
    etapa = "executor";
    // Runner dedicado: nem imagens nem containers prévios podem mascarar o Docker load.
    for (const args of [["image", "ls", "-aq"], ["ps", "-aq"]]) {
      if (executar("docker", args, { timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] }).toString().trim()) throw Error("Docker não está vazio.");
    }
    etapa = "carregar";
    executar("docker", ["load", "--input", arquivo], { timeout: 600_000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    etapa = "identidade";
    const lista = JSON.parse(executar("docker", ["image", "inspect", TAG], { timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] }).toString());
    const r = lista[0];
    if (lista.length !== 1 || ![ID, imagem.configId].includes(r.Id) || r.Os !== "linux" || r.Architecture !== "amd64" ||
        JSON.stringify(r.RootFS?.Layers) !== JSON.stringify(ROOTFS) || JSON.stringify(r.RepoTags) !== JSON.stringify([TAG])) throw Error("Identidade restaurada divergente.");
    if (!Array.isArray(r.Config?.Env) || r.Config.Env.some(e => /^(NODE_OPTIONS|NODE_PATH|LD_PRELOAD)=[\s\S]+$/.test(e))) throw Error("Preload inesperado na imagem histórica.");
    etapa = "app";
    validarSmoke(executar("docker", argumentosSmoke(), { timeout: 120_000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).toString());
    return { restauracaoIsoladaValidada: true, aplicacaoSinteticaValidada: true,
      identidadeRestaurada: { idOriginal: ID, configId: imagem.configId, idRestaurado: r.Id, formato: imagem.formato } };
  } catch { throw Object.assign(Error("Restauração do app não comprovada."), { etapa }); }
}
export async function executarFluxo(etapas) {
  const antes = await etapas.preparar();
  validarPreparacao(antes);
  const arquivo = await etapas.transferir(antes);
  const prova = await etapas.validar(antes, arquivo);
  if (prova?.restauracaoIsoladaValidada !== true || prova.aplicacaoSinteticaValidada !== true) throw Error("Prova de recuperação incompleta.");
  const r = await etapas.concluir(antes);
  if (r?.concluido !== true || r.alvo !== ALVO || r.sha256 !== antes.sha256 || r.bytes !== antes.bytes ||
      r.containersVolumesBackupsConfiguracaoPreservados !== true || JSON.stringify(r.imagensArquivadas) !== JSON.stringify(antes.imagens)) throw Error("Conclusão não comprovada.");
  return { ...r, ...prova };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) void executarArquivamento();
async function executarArquivamento() {
  let privado, recibo, etapa = "configuracao";
  try {
    if (process.env.GITHUB_ACTIONS !== "true" || process.env.RUNNER_OS !== "Linux" || process.env.DOCKER_HOST || process.env.DOCKER_CONTEXT ||
        process.env.GITHUB_REF !== "refs/heads/" + BRANCH || process.env.ARQUIVAMENTO_ALVO !== ALVO) throw Error("Executor ou alvo não autorizado.");
    const p = parametros(process.env), imagem = process.env.VPS_IMAGEM_ANTERIOR;
    if (imagem !== APP_ESPERADO || !process.argv[2]) throw Error("Imagem instalada ou destino divergente.");
    const codigoCanonico = readFileSync(new URL("./arquivar_workers.py", import.meta.url), "utf8");
    if (createHash("sha256").update(codigoCanonico).digest("hex") !== CANONICO_SHA256) throw Error("Fonte canônica alterada.");
    const codigo = readFileSync(new URL("./arquivar_homolog.py", import.meta.url), "utf8");
    const publica = process.env.RELATORIO_CHAVE_PUBLICA;
    const inicial = comprovanteCifrado({ concluido: false, alvo: ALVO }, publica);
    recibo = openSync(process.argv[2], "wx", 0o600); writeFileSync(recibo, inicial); fsyncSync(recibo);
    privado = mkdtempSync(join(tmpdir(), "barberos-homolog-archive-"));
    const chave = join(privado, "identity"), hosts = join(privado, "known_hosts");
    writeFileSync(chave, process.env.VPS_SSH_KEY.replace(/\r\n/g, "\n").trimEnd() + "\n", { mode: 0o600 });
    writeFileSync(hosts, process.env.VPS_KNOWN_HOSTS.trimEnd() + "\n", { mode: 0o600 });
    const ssh = ["-F", "none", "-T", "-p", p.porta, "-i", chave, "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
      "-o", "IdentityAgent=none", "-o", "StrictHostKeyChecking=yes", "-o", "HostKeyAlgorithms=ssh-ed25519",
      "-o", "GlobalKnownHostsFile=/dev/null", "-o", "UserKnownHostsFile=" + hosts, "-o", "ConnectTimeout=15",
      "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=4", p.usuario + "@" + p.host];
    const remoto = (comando, opcoes = {}) => execFileSync("ssh", [...ssh, comando], { timeout: 720_000,
      maxBuffer: 1024 * 1024, stdio: ["pipe", "pipe", "pipe"], ...opcoes });
    const python = (modo, extras = {}) => JSON.parse(remoto("python3 -c " + shell(codigo), {
      input: JSON.stringify({ codigoCanonico, modo, base: p.base, projeto: p.projeto, imagemApp: imagem, ...extras }),
    }).toString());
    const r = await executarFluxo({
      preparar: () => { etapa = "preparar"; return python(process.env.ARQUIVAMENTO_RETOMAR === "true" ? "retomar" : "preparar"); },
      transferir: antes => {
        etapa = "transferencia";
        const arquivo = join(privado, "homolog.tar.gz"), fd = openSync(arquivo, "wx", 0o600);
        try { remoto("cat -- " + shell(p.base + "/worker-archives/" + antes.arquivo), { stdio: ["ignore", fd, "pipe"] }); }
        finally { closeSync(fd); }
        return arquivo;
      },
      validar: (antes, arquivo) => { etapa = "restauracao"; return validarCopia(antes, arquivo); },
      concluir: antes => { etapa = "concluir"; return python("concluir", { arquivo: antes.arquivo, sha256: antes.sha256 }); },
    });
    const final = comprovanteCifrado(r, publica);
    ftruncateSync(recibo, 0); writeSync(recibo, final, 0, final.length, 0); fsyncSync(recibo);
    process.stdout.write("App histórico arquivado; restauração e sintaxe isoladas comprovadas; cópia preservada na VPS.\n");
  } catch (erro) {
    if (recibo !== undefined) {
      const falha = comprovanteCifrado({ concluido: false, alvo: ALVO, etapa, etapaRestauracao: erro?.etapa || null }, process.env.RELATORIO_CHAVE_PUBLICA);
      ftruncateSync(recibo, 0); writeSync(recibo, falha, 0, falha.length, 0); fsyncSync(recibo);
    }
    process.stderr.write("Arquivamento do app não comprovado; não prosseguir com publicação. Cópias concluídas permanecem na VPS.\n");
    process.exitCode = 1;
  } finally {
    if (recibo !== undefined) closeSync(recibo);
    if (privado) rmSync(privado, { recursive: true, force: true });
  }
}
