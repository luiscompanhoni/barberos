/** Arquiva somente o worker selecionado, após restauração comprovada no executor. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, createReadStream, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parametros } from "./consultar-vps.mjs";

const shell = s => "'" + s.replace(/'/g, "'\\''") + "'";
const TAG = "barberos-video-worker:f7968a11b1892b07eaad46b659ad7c5d18bb9bd4";
const ID = /^sha256:32855fc2a5d7[a-f0-9]{52}$/;
export function validarPreparacao(antes) {
  if (!antes || !/^workers-\d+\.tar\.gz$/.test(antes.arquivo) || !/^[a-f0-9]{64}$/.test(antes.sha256) ||
    !Array.isArray(antes.imagens) || antes.imagens.length !== 1 || antes.imagens[0]?.tag !== TAG || !ID.test(antes.imagens[0].id)) {
    throw new Error("Arquivo, tag ou identidade inesperada.");
  }
}
export function validarRestauracao(esperada, restaurada) {
  if (esperada.tag !== TAG || !ID.test(esperada.id) || restaurada?.Id !== esperada.id ||
    !Array.isArray(restaurada.RepoTags) || !restaurada.RepoTags.includes(TAG)) throw new Error("Tag ou identidade restaurada divergente.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await executarArquivamento();
async function executarArquivamento() {
  const p = parametros(process.env);
  const imagem = process.env.VPS_IMAGEM_ANTERIOR;
  if (!/^sha256:[a-f0-9]{64}$/.test(imagem) || !process.argv[2]) throw new Error("Identificação ou destino ausente.");
  const privado = mkdtempSync(join(tmpdir(), "barberos-worker-archive-"));
  try {
    const chave = join(privado, "identity"), hosts = join(privado, "known_hosts");
    writeFileSync(chave, process.env.VPS_SSH_KEY.replace(/\r\n/g, "\n").trimEnd() + "\n", { mode: 0o600 });
    writeFileSync(hosts, process.env.VPS_KNOWN_HOSTS.trimEnd() + "\n", { mode: 0o600 });
    const ssh = ["-F", "none", "-T", "-p", p.porta, "-i", chave, "-o", "BatchMode=yes",
      "-o", "IdentitiesOnly=yes", "-o", "IdentityAgent=none", "-o", "StrictHostKeyChecking=yes",
      "-o", "HostKeyAlgorithms=ssh-ed25519", "-o", "GlobalKnownHostsFile=/dev/null",
      "-o", `UserKnownHostsFile=${hosts}`, "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=15",
      "-o", "ServerAliveCountMax=4", `${p.usuario}@${p.host}`];
    const remoto = (comando, opcoes = {}) => execFileSync("ssh", [...ssh, comando], {
      timeout: 720_000, maxBuffer: 1024 * 1024, stdio: ["pipe", "pipe", "pipe"], ...opcoes,
    });
    const codigo = readFileSync(new URL("./arquivar_workers.py", import.meta.url), "utf8");
    const python = (modo, extras = []) => JSON.parse(remoto("python3 -c " + shell(codigo) + " " +
      [modo, p.base, p.projeto, imagem, ...extras].map(shell).join(" ")).toString());
    const antes = python("preparar");
    validarPreparacao(antes);
    process.stdout.write("Arquivo preservado na VPS; conferindo restauração isolada.\n");
    const arquivo = join(privado, "workers.tar.gz");
    const fd = openSync(arquivo, "wx", 0o600);
    try { remoto("cat -- " + shell(`${p.base}/worker-archives/${antes.arquivo}`), { stdio: ["ignore", fd, "pipe"] }); }
    finally { closeSync(fd); }
    const hash = createHash("sha256");
    for await (const b of createReadStream(arquivo)) hash.update(b);
    if (hash.digest("hex") !== antes.sha256) throw new Error("Arquivo transportado divergente.");
    execFileSync("docker", ["load", "--input", arquivo], { timeout: 600_000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    for (const i of antes.imagens) {
      const restaurada = JSON.parse(execFileSync("docker", ["image", "inspect", i.tag]).toString())[0];
      validarRestauracao(i, restaurada);
      execFileSync("docker", ["run", "--rm", "--network", "none", "--read-only", "--entrypoint", "node", i.tag, "--version"], { timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] });
    }
    process.stdout.write("Identidade e tag do worker restaurado confirmadas.\n");
    const r = { ...python("concluir", [antes.arquivo, antes.sha256]), restauracaoIsoladaValidada: true };
    writeFileSync(process.argv[2], JSON.stringify(r, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    process.stdout.write("Arquivo de recuperação mantido; aplicação, containers, volumes e backups preservados.\n");
  } catch {
    process.stderr.write("Arquivamento não comprovado; não prosseguir com publicação. Arquivos já concluídos permanecem na VPS.\n");
    process.exitCode = 1;
  } finally { rmSync(privado, { recursive: true, force: true }); }
}
