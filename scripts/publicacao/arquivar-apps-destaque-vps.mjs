/** Arquiva uma das seis imagens aprovadas, com todos os aliases e recuperação comprovada. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, fsyncSync, ftruncateSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parametros } from "./consultar-vps.mjs";
import { comprovanteCifrado } from "./arquivar-workers-vps.mjs";
import { argumentosSmoke as smokeHomolog, TAG as TAG_HOMOLOG, validarCi, validarSmoke, inventariarExecutor } from "./arquivar-homolog-vps.mjs";
import { conferirArquivo, extrairMetadados, validarManifesto } from "./transferir-arquivos-workers.mjs";

export { validarCi };
export const ALVOS_SHA256 = "eedb1ec316f86f742e673cd7ed758f8593a02b03ab03421780a60befd1a61b72";
const digest = raw => createHash("sha256").update(raw).digest("hex");
export const codigoAlvos = readFileSync(new URL("./apps-destaque-autorizados.json", import.meta.url), "utf8");
if (digest(codigoAlvos) !== ALVOS_SHA256) throw Error("Inventário nominal alterado.");
export const NOMINAIS = JSON.parse(codigoAlvos);
export const APP_ESPERADO = NOMINAIS.imagemApp;
export const ALVOS = Object.freeze(NOMINAIS.alvos.map(i => i.alvo));
const shell = s => "'" + s.replace(/'/g, "'\\''") + "'";
const iguais = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const mesmoConjunto = (a, b) => Array.isArray(a) && Array.isArray(b) && new Set(a).size === a.length && iguais([...a].sort(), [...b].sort());
const CODIGOS_EXECUTOR = new Set(["cli_indisponivel", "alvo_presente", "containers_presentes", "inventario_malformado", "imagens_preexistentes_alteradas"]);
const erroExecutor = codigo => Object.assign(Error("Executor Docker não comprovado."), { codigo });
export function selecionarAlvo(alvo) {
  const i = NOMINAIS.alvos.find(i => i.alvo === alvo);
  if (!i) throw Error("Imagem fora das seis autorizadas.");
  return structuredClone(i);
}
export function validarPreparacao(r, alvo = r?.alvo) {
  const nominal = selecionarAlvo(alvo);
  const imagens = nominal.tags.map(tag => ({ tag, id: nominal.id, bytesImagem: nominal.bytes }));
  if (r?.formato !== 2 || r.alvo !== alvo || r.imagemApp !== APP_ESPERADO || !/^workers-\d+\.tar\.gz$/.test(r.arquivo) ||
      !/^[a-f0-9]{64}$/.test(r.sha256) || !Number.isSafeInteger(r.bytes) || r.bytes <= 0 || r.bytes > 2_000_000_000 ||
      !iguais(r.imagens, imagens)) throw Error("Preparação nominal divergente.");
  return nominal;
}
function lerJson(metadados, nome) {
  const e = metadados[nome], raw = typeof e?.base64 === "string" && Buffer.from(e.base64, "base64");
  if (!raw || raw.length > 1024 ** 2 || e.bytes !== raw.length || e.sha256 !== digest(raw)) throw Error("Metadado físico divergente.");
  return JSON.parse(raw.toString());
}
function metadadoJson(objeto) {
  const raw = Buffer.from(JSON.stringify(objeto));
  return { bytes: raw.length, sha256: digest(raw), base64: raw.toString("base64") };
}
// Todos os blobs devem pertencer à cadeia original de uma única imagem; não se aceita outra imagem oculta no tar.
function validarFechamentoBlobs(metadados, descritor) {
  const vistos = new Set();
  const visitar = d => {
    if (!/^sha256:[a-f0-9]{64}$/.test(d?.digest || "")) throw Error("Descritor inválido.");
    const nome = "blobs/sha256/" + d.digest.slice(7), e = metadados[nome];
    if (!e || e.sha256 !== d.digest.slice(7) || e.bytes !== d.size) throw Error("Blob físico divergente.");
    if (vistos.has(nome)) return;
    vistos.add(nome);
    if (d.mediaType === "application/vnd.oci.image.index.v1+json") {
      for (const filho of lerJson(metadados, nome).manifests || []) visitar(filho);
    } else if (d.mediaType === "application/vnd.oci.image.manifest.v1+json") {
      const m = lerJson(metadados, nome);
      for (const filho of [m.config, ...(m.layers || []), ...(m.subject ? [m.subject] : [])]) visitar(filho);
    }
  };
  visitar(descritor);
  if (Object.keys(metadados).some(n => !["manifest.json", "index.json", "oci-layout"].includes(n) && !vistos.has(n))) throw Error("Arquivo contém conteúdo alheio à imagem nominal.");
}
export function validarAliases(antes, metadados, manifestar = validarManifesto) {
  return validarManifestoAliases(antes, metadados, validarPreparacao(antes), manifestar);
}
// A variante genérica permite homologar o parser com blobs sintéticos; o fluxo operacional sempre fixa o nominal acima.
export function validarManifestoAliases(antes, metadados, nominal, manifestar = validarManifesto) {
  const manifesto = lerJson(metadados, "manifest.json");
  if (!Array.isArray(manifesto) || !manifesto.length || manifesto.length > nominal.tags.length ||
      manifesto.some(m => !Array.isArray(m.RepoTags) || !m.RepoTags.length) ||
      !mesmoConjunto(manifesto.flatMap(m => m.RepoTags), nominal.tags)) throw Error("Aliases físicos divergentes.");
  const primeiro = manifesto[0];
  if (manifesto.some(m => m.Config !== primeiro.Config || !iguais(m.Layers, primeiro.Layers))) throw Error("Aliases apontam para imagens diferentes.");
  const indice = lerJson(metadados, "index.json");
  if (!Array.isArray(indice.manifests) || !mesmoConjunto(indice.manifests.map(d => d.annotations?.["io.containerd.image.name"]), nominal.tags.map(t => "docker.io/library/" + t)) ||
      indice.manifests.some(d => d.digest !== nominal.id)) throw Error("Inventário OCI nominal divergente.");
  validarFechamentoBlobs(metadados, indice.manifests[0]);
  // Projeta apenas o inventário de aliases já conferido. Configuração, índices, layers e atestações continuam os blobs físicos originais.
  const imagens = antes.imagens.map(imagem => {
    const d = indice.manifests.find(d => d.annotations["io.containerd.image.name"] === "docker.io/library/" + imagem.tag);
    const vista = { ...metadados, "index.json": metadadoJson({ ...indice, manifests: [d] }) };
    const [r] = manifestar([{ ...primeiro, RepoTags: [imagem.tag] }], { ...antes, imagens: [imagem] }, vista, { permitirAtestacaoVazia: true });
    if (!iguais(r.diffIds, nominal.rootfs.Layers)) throw Error("RootFS nominal divergente.");
    return r;
  });
  if (imagens.some(i => !iguais([i.configId, i.manifestId, i.formato], [imagens[0].configId, imagens[0].manifestId, imagens[0].formato]))) throw Error("Identidades de aliases divergentes.");
  return imagens[0];
}
export function argumentosSmoke(tag) {
  return smokeHomolog().map(v => v === TAG_HOMOLOG ? tag : v);
}
const identidadeInventario = i => JSON.stringify([i.ID, i.Repository, i.Tag]);
export async function validarCopia(antes, arquivo, executar = execFileSync, conferir = conferirArquivo, extrair = extrairMetadados, manifestar = validarManifesto, conferirAliases = validarAliases) {
  let etapa = "arquivo";
  try {
    const nominal = validarPreparacao(antes);
    await conferir(arquivo, antes);
    etapa = "metadados";
    const imagem = conferirAliases(antes, extrair(arquivo, executar), manifestar);
    etapa = "executor";
    const preexistentes = inventariarExecutor(executar);
    if (preexistentes.some(i => [nominal.id, imagem.configId].includes(i.ID) || nominal.tags.includes(i.Repository + ":" + i.Tag))) throw erroExecutor("alvo_presente");
    etapa = "carregar";
    executar("docker", ["load", "--input", arquivo], { timeout: 600_000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    etapa = "identidade";
    let restaurado;
    for (const tag of nominal.tags) {
      const lista = JSON.parse(executar("docker", ["image", "inspect", tag], { timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] }).toString());
      const r = lista[0];
      if (lista.length !== 1 || ![nominal.id, imagem.configId].includes(r.Id) || (restaurado && restaurado !== r.Id) || r.Os !== nominal.os || r.Architecture !== nominal.architecture ||
          !iguais(r.RootFS, nominal.rootfs) || !mesmoConjunto(r.RepoTags, nominal.tags)) throw Error("Identidade restaurada divergente.");
      if (!Array.isArray(r.Config?.Env) || r.Config.Env.some(e => /^(NODE_OPTIONS|NODE_PATH|LD_PRELOAD)=[\s\S]+$/.test(e))) throw Error("Preload inesperado na imagem histórica.");
      restaurado = r.Id;
    }
    etapa = "app";
    validarSmoke(executar("docker", argumentosSmoke(nominal.tags[0]), { timeout: 120_000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).toString());
    etapa = "executor";
    const depois = new Set(inventariarExecutor(executar).map(identidadeInventario));
    if (preexistentes.some(i => !depois.has(identidadeInventario(i)))) throw erroExecutor("imagens_preexistentes_alteradas");
    for (const tag of nominal.tags) {
      const [Repository, Tag] = tag.split(":");
      if (!depois.has(identidadeInventario({ ID: restaurado, Repository, Tag }))) throw erroExecutor("inventario_malformado");
    }
    return { alvo: antes.alvo, arquivo: antes.arquivo, sha256: antes.sha256, bytes: antes.bytes, imagens: structuredClone(antes.imagens),
      restauracaoIsoladaValidada: true, aplicacaoSinteticaValidada: true,
      executor: { imagensPreexistentesCount: new Set(preexistentes.map(i => i.ID)).size, alvoAusenteAntesLoad: true,
        containersAusentesAntesEDepois: true, imagensPreexistentesPreservadas: true, blobsVerificados: true },
      identidadeRestaurada: { idOriginal: nominal.id, configId: imagem.configId, idRestaurado: restaurado, formato: imagem.formato } };
  } catch (erro) { throw Object.assign(Error("Restauração do app não comprovada."), { etapa,
    diagnosticoExecutor: CODIGOS_EXECUTOR.has(erro?.codigo) ? erro.codigo : null }); }
}
export async function executarFluxo(etapas, alvo, base = "/opt/barberos") {
  selecionarAlvo(alvo);
  const antes = await etapas.preparar();
  validarPreparacao(antes, alvo);
  const arquivo = await etapas.transferir(antes), prova = await etapas.validar(antes, arquivo);
  const campos = ["alvo", "arquivo", "sha256", "bytes", "imagens"];
  if (prova?.restauracaoIsoladaValidada !== true || prova.aplicacaoSinteticaValidada !== true || campos.some(c => !iguais(prova[c], antes[c]))) throw Error("Prova de recuperação incompleta.");
  const provaRestauracao = Object.fromEntries(campos.map(c => [c, structuredClone(antes[c])]));
  Object.assign(provaRestauracao, { restauracaoIsoladaValidada: true, aplicacaoSinteticaValidada: true });
  const r = await etapas.concluir(antes, provaRestauracao);
  if (r?.concluido !== true || r.alvo !== alvo || r.arquivo !== base + "/worker-archives/" + antes.arquivo || r.sha256 !== antes.sha256 || r.bytes !== antes.bytes ||
      r.containersVolumesBackupsConfiguracaoPreservados !== true || r.restauracaoIsoladaValidada !== true || r.aplicacaoSinteticaValidada !== true ||
      !iguais(r.imagensArquivadas, antes.imagens)) throw Error("Conclusão não comprovada.");
  return { ...r, executor: prova.executor, identidadeRestaurada: prova.identidadeRestaurada };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) void executarArquivamento();
async function executarArquivamento() {
  let privado, recibo, alvo, etapa = "configuracao";
  try {
    if (process.env.GITHUB_ACTIONS !== "true" || process.env.RUNNER_OS !== "Linux" || process.env.DOCKER_HOST || process.env.DOCKER_CONTEXT ||
        process.env.GITHUB_REF !== "refs/heads/main") throw Error("Executor não autorizado.");
    alvo = selecionarAlvo(process.env.ARQUIVAMENTO_ALVO).alvo;
    validarCi(JSON.parse(readFileSync(process.env.ARQUIVAMENTO_CI_JSON, "utf8")), process.env);
    if (process.env.VPS_IMAGEM_ANTERIOR !== APP_ESPERADO || !process.argv[2]) throw Error("Imagem instalada ou destino divergente.");
    const codigoCanonico = readFileSync(new URL("./arquivar_workers.py", import.meta.url), "utf8");
    if (digest(codigoCanonico) !== NOMINAIS.canonicoSha256) throw Error("Fonte canônica alterada.");
    const codigo = readFileSync(new URL("./arquivar_apps_destaque.py", import.meta.url), "utf8");
    const publica = process.env.RELATORIO_CHAVE_PUBLICA, inicial = comprovanteCifrado({ concluido: false, alvo }, publica);
    const p = parametros(process.env);
    recibo = openSync(process.argv[2], "wx", 0o600); writeFileSync(recibo, inicial); fsyncSync(recibo);
    privado = mkdtempSync(join(tmpdir(), "barberos-apps-destaque-"));
    const chave = join(privado, "identity"), hosts = join(privado, "known_hosts");
    writeFileSync(chave, process.env.VPS_SSH_KEY.replace(/\r\n/g, "\n").trimEnd() + "\n", { mode: 0o600 });
    writeFileSync(hosts, process.env.VPS_KNOWN_HOSTS.trimEnd() + "\n", { mode: 0o600 });
    const ssh = ["-F", "none", "-T", "-p", p.porta, "-i", chave, "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "IdentityAgent=none",
      "-o", "StrictHostKeyChecking=yes", "-o", "HostKeyAlgorithms=ssh-ed25519", "-o", "GlobalKnownHostsFile=/dev/null", "-o", "UserKnownHostsFile=" + hosts,
      "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=4", p.usuario + "@" + p.host];
    const remoto = (comando, opcoes = {}) => execFileSync("ssh", [...ssh, comando], { timeout: 720_000, maxBuffer: 1024 * 1024, stdio: ["pipe", "pipe", "pipe"], ...opcoes });
    const python = (modo, extras = {}) => JSON.parse(remoto("python3 -c " + shell(codigo), {
      input: JSON.stringify({ codigoCanonico, codigoAlvos, alvo, modo, base: p.base, projeto: p.projeto, imagemApp: APP_ESPERADO, ...extras }),
    }).toString());
    const r = await executarFluxo({
      preparar: () => { etapa = "preparar"; return python(process.env.ARQUIVAMENTO_RETOMAR === "true" ? "retomar" : "preparar"); },
      transferir: antes => {
        etapa = "transferencia";
        const arquivo = join(privado, "app-legado.tar.gz"), fd = openSync(arquivo, "wx", 0o600);
        try { remoto("cat -- " + shell(p.base + "/worker-archives/" + antes.arquivo), { stdio: ["ignore", fd, "pipe"] }); }
        finally { closeSync(fd); }
        return arquivo;
      },
      validar: (antes, arquivo) => { etapa = "restauracao"; return validarCopia(antes, arquivo); },
      concluir: (antes, provaRestauracao) => { etapa = "concluir"; return python("concluir", { arquivo: antes.arquivo, sha256: antes.sha256, provaRestauracao }); },
    }, alvo, p.base);
    const final = comprovanteCifrado(r, publica);
    ftruncateSync(recibo, 0); writeSync(recibo, final, 0, final.length, 0); fsyncSync(recibo);
    process.stdout.write("Imagem histórica e aliases arquivados; recuperação isolada comprovada; cópia preservada na VPS.\n");
  } catch (erro) {
    if (recibo !== undefined) {
      const falha = comprovanteCifrado({ concluido: false, alvo, etapa, etapaRestauracao: erro?.etapa || null,
        diagnosticoExecutor: CODIGOS_EXECUTOR.has(erro?.diagnosticoExecutor) ? erro.diagnosticoExecutor : null }, process.env.RELATORIO_CHAVE_PUBLICA);
      ftruncateSync(recibo, 0); writeSync(recibo, falha, 0, falha.length, 0); fsyncSync(recibo);
    }
    process.stderr.write("Arquivamento não comprovado; não prosseguir com publicação. Cópias concluídas permanecem na VPS.\n");
    process.exitCode = 1;
  } finally {
    if (recibo !== undefined) closeSync(recibo);
    if (privado) rmSync(privado, { recursive: true, force: true });
  }
}
