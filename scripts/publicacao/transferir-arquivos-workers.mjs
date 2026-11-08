/** Valida uma restauração no CI; nunca apaga o arquivo remoto ou ativa o worker. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, createReadStream, fstatSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { argumentosSmoke, validarSmoke } from "./arquivar-workers-vps.mjs";
import { parametros } from "./consultar-vps.mjs";
import { cifrar } from "./cifrar-relatorio.mjs";

const shell = s => "'" + s.replace(/'/g, "'\\''") + "'";
const codigoPath = fileURLToPath(new URL("./transferir_arquivos_workers.py", import.meta.url));
export function inventario(executar = execFileSync) {
  return JSON.parse(executar("python3", [codigoPath, "--inventario"], { timeout: 10_000 }).toString());
}
export function selecionar(nome, alvos) {
  if (!Object.hasOwn(alvos, nome)) throw Error("Arquivo fora dos quatro alvos revisados.");
  return { arquivo: nome, ...alvos[nome] };
}
export function validarManifesto(manifesto, esperado) {
  if (!Array.isArray(manifesto) || manifesto.length !== esperado.imagens.length ||
      manifesto.some(i => !Array.isArray(i.RepoTags) || i.RepoTags.length !== 1)) throw Error("Manifesto de imagens inesperado.");
  const tags = manifesto.map(i => i.RepoTags[0]).sort();
  if (JSON.stringify(tags) !== JSON.stringify(esperado.imagens.map(i => i.tag).sort())) throw Error("Tags do arquivo divergentes.");
  for (const imagem of esperado.imagens) {
    const m = manifesto.find(i => i.RepoTags[0] === imagem.tag);
    // O nome da configuração pode ser o digest simples ou o caminho OCI do digest.
    const digest = imagem.id.slice(7);
    if (![digest + ".json", "blobs/sha256/" + digest].includes(m.Config)) throw Error("Configuração da imagem divergente.");
  }
}
export async function conferirArquivo(arquivo, esperado) {
  if (!constants.O_NOFOLLOW) throw Error("A leitura segura exige Linux.");
  const fd = openSync(arquivo, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const antes = fstatSync(fd);
    if (!antes.isFile() || antes.size !== esperado.bytes) throw Error("Tamanho ou tipo do arquivo divergente.");
    const hash = createHash("sha256");
    for await (const b of createReadStream(arquivo, { fd, autoClose: false, start: 0 })) hash.update(b);
    const depois = fstatSync(fd);
    if (hash.digest("hex") !== esperado.sha256 || antes.dev !== depois.dev || antes.ino !== depois.ino ||
        antes.size !== depois.size || antes.mtimeMs !== depois.mtimeMs) throw Error("Arquivo mudou ou hash divergiu.");
  } finally { closeSync(fd); }
}
export async function validarRestauracao(arquivo, esperado, executar = execFileSync, conferir = conferirArquivo) {
  await conferir(arquivo, esperado);
  const manifesto = JSON.parse(executar("tar", ["-xOf", arquivo, "manifest.json"], { timeout: 60_000, maxBuffer: 1024 * 1024 }).toString());
  validarManifesto(manifesto, esperado);
  executar("docker", ["load", "--input", arquivo], { timeout: 600_000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  for (const imagem of esperado.imagens) {
    const restauradas = JSON.parse(executar("docker", ["image", "inspect", imagem.tag], { timeout: 30_000 }).toString());
    if (restauradas.length !== 1 || restauradas[0].Id !== imagem.id ||
      JSON.stringify(restauradas[0].RepoTags) !== JSON.stringify([imagem.tag])) throw Error("Identidade restaurada divergente.");
    const resposta = executar("docker", argumentosSmoke(imagem.tag), { timeout: 600_000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    validarSmoke(resposta.toString());
  }
  return { formato: 1, ...esperado, restauracaoIsoladaValidada: true, renderSinteticoValidado: true };
}
export async function executarFluxo(etapas, esperado) {
  const arquivo = await etapas.transferir();
  const resultado = await etapas.validar(arquivo, esperado);
  if (resultado.sha256 !== esperado.sha256 || resultado.arquivo !== esperado.arquivo ||
      resultado.bytes !== esperado.bytes || resultado.restauracaoIsoladaValidada !== true ||
      resultado.renderSinteticoValidado !== true || JSON.stringify(resultado.imagens) !== JSON.stringify(esperado.imagens)) {
    throw Error("Prova de restauração incompleta.");
  }
  await etapas.registrar(resultado);
  return resultado;
}
export function cifrarProva(r, contexto, publica) {
  // Somente estes campos podem sair como relatório. Nenhum env/corpo bruto.
  const prova = { formato: 1, arquivo: r.arquivo, sha256: r.sha256, bytes: r.bytes,
    imagens: r.imagens.map(i => ({ tag: i.tag, id: i.id })),
    restauracaoIsoladaValidada: r.restauracaoIsoladaValidada, renderSinteticoValidado: r.renderSinteticoValidado,
    repositorio: contexto.repositorio, workflow: "validar-arquivos-workers.yml",
    commit: contexto.commit, runId: contexto.runId, somenteLeituraVPS: true };
  return cifrar(Buffer.from(JSON.stringify(prova)), publica);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await principal();
async function principal() {
  let privado;
  try {
    if (process.env.GITHUB_ACTIONS !== "true" || process.env.RUNNER_OS !== "Linux" || process.env.DOCKER_HOST || process.env.DOCKER_CONTEXT) {
      throw Error("Validação exige Docker local no executor Linux efêmero.");
    }
    const esperado = selecionar(process.env.ARQUIVO_WORKERS, inventario());
    if (!process.argv[2]) throw Error("Destino do comprovante ausente.");
    // Recusa chave ausente/fraca antes de qualquer consulta à VPS.
    cifrar(Buffer.from("{}"), process.env.RELATORIO_CHAVE_PUBLICA);
    const p = parametros(process.env);
    privado = mkdtempSync(join(tmpdir(), "barberos-arquivos-workers-"));
    const chave = join(privado, "identity"), hosts = join(privado, "known_hosts");
    writeFileSync(chave, process.env.VPS_SSH_KEY.replace(/\r\n/g, "\n").trimEnd() + "\n", { mode: 0o600 });
    writeFileSync(hosts, process.env.VPS_KNOWN_HOSTS.trimEnd() + "\n", { mode: 0o600 });
    const ssh = ["-F", "none", "-T", "-p", p.porta, "-i", chave, "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
      "-o", "IdentityAgent=none", "-o", "StrictHostKeyChecking=yes", "-o", "HostKeyAlgorithms=ssh-ed25519",
      "-o", "GlobalKnownHostsFile=/dev/null", "-o", "UserKnownHostsFile=" + hosts, "-o", "ConnectTimeout=15",
      "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=4", p.usuario + "@" + p.host];
    const arquivo = join(privado, esperado.arquivo);
    await executarFluxo({
      transferir: () => {
        const fd = openSync(arquivo, "wx", 0o600);
        try {
          const codigo = readFileSync(codigoPath, "utf8");
          const comando = "python3 -c " + shell(codigo) + " " + ["exportar", p.base, esperado.arquivo].map(shell).join(" ");
          execFileSync("ssh", [...ssh, comando], { timeout: 720_000, stdio: ["ignore", fd, "pipe"], maxBuffer: 1024 * 1024 });
        } finally { closeSync(fd); }
        return arquivo;
      },
      validar: validarRestauracao,
      registrar: r => {
        const contexto = { repositorio: process.env.GITHUB_REPOSITORY, commit: process.env.GITHUB_SHA, runId: Number(process.env.GITHUB_RUN_ID) };
        const envelope = cifrarProva(r, contexto, process.env.RELATORIO_CHAVE_PUBLICA);
        writeFileSync(process.argv[2], JSON.stringify(envelope), { flag: "wx", mode: 0o600 });
      },
    }, esperado);
    console.log("Arquivo restaurado e renderizado sem rede. A cópia da VPS continua preservada; nenhum descarte foi executado.");
  } catch {
    console.error("Restauração não comprovada; não remover nenhum arquivo da VPS.");
    process.exitCode = 1;
  } finally {
    if (privado) rmSync(privado, { recursive: true, force: true });
  }
}
