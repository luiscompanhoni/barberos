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
  return JSON.parse(executar("python3", [codigoPath, "--inventario"], { timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] }).toString());
}
export function selecionar(nome, alvos) {
  if (!Object.hasOwn(alvos, nome)) throw Error("Arquivo fora dos quatro alvos revisados.");
  return { arquivo: nome, ...alvos[nome] };
}
const INDEX = "application/vnd.oci.image.index.v1+json";
const MANIFEST = "application/vnd.oci.image.manifest.v1+json";
const CONFIG = "application/vnd.oci.image.config.v1+json";
const EMPTY = "application/vnd.oci.empty.v1+json";
const EMPTY_DIGEST = "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a";
const IN_TOTO = "application/vnd.in-toto+json", SLSA = "https://slsa.dev/provenance/v1";
const DIGEST = /^sha256:[a-f0-9]{64}$/;
// Não materializa tar nem layers: só inventário e metadados limitados em memória.
export const LEITOR_TAR = String.raw`import base64,hashlib,json,re,sys,tarfile
arquivos={}; vistos=set(); memoria=0; total=0
with tarfile.open(sys.argv[1],"r|gz") as tar:
 for item in tar:
  nome=item.name
  if len(vistos)>=1024 or len(nome)>160 or nome.startswith("/") or ".." in nome.split("/") or nome in vistos:
   raise RuntimeError("Inventario invalido")
  vistos.add(nome)
  if item.isdir(): continue
  if not item.isfile() or item.size<0: raise RuntimeError("Tipo invalido")
  total+=item.size
  if total>16*1024**3: raise RuntimeError("Limite do arquivo")
  entrada={"bytes":item.size}; arquivos[nome]=entrada
  pequeno=nome in ("manifest.json","index.json","oci-layout") or re.fullmatch(r"(?:blobs/sha256/[a-f0-9]{64}|[a-f0-9]{64}\.json)",nome)
  guardar=bool(pequeno and item.size<=1024**2)
  if guardar:
   memoria+=item.size
   if memoria>16*1024**2: raise RuntimeError("Limite dos metadados")
  digest=hashlib.sha256(); lidos=0; partes=[]
  with tar.extractfile(item) as fonte:
   while bloco:=fonte.read(1024**2):
    lidos+=len(bloco)
    if lidos>item.size: raise RuntimeError("Leitura excedente")
    digest.update(bloco)
    if guardar: partes.append(bloco)
  if lidos!=item.size: raise RuntimeError("Leitura incompleta")
  entrada["sha256"]=digest.hexdigest()
  if guardar: entrada["base64"]=base64.b64encode(b"".join(partes)).decode("ascii")
print(json.dumps(arquivos,separators=(",",":")))`;
export function extrairMetadados(arquivo, executar = execFileSync) {
  return JSON.parse(executar("python3", ["-c", LEITOR_TAR, arquivo], { timeout: 120_000, maxBuffer: 24 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).toString());
}
function entrada(metadados, nome, descriptor) {
  const e = Object.hasOwn(metadados, nome) && metadados[nome];
  if (!e || !Number.isSafeInteger(e.bytes) || e.bytes < 0 ||
      (descriptor && (e.bytes !== descriptor.size || nome !== "blobs/sha256/" + descriptor.digest.slice(7) ||
        e.sha256 !== descriptor.digest.slice(7)))) throw Error("Blob ausente, tamanho ou digest divergente.");
  return e;
}
function jsonMetadados(metadados, nome, descriptor) {
  const e = entrada(metadados, nome, descriptor);
  if (typeof e.base64 !== "string" || e.bytes > 1024 ** 2) throw Error("Metadado ausente ou acima do limite.");
  const raw = Buffer.from(e.base64, "base64"), hash = createHash("sha256").update(raw).digest("hex");
  if (raw.length !== e.bytes || hash !== e.sha256 || (descriptor && "sha256:" + hash !== descriptor.digest)) throw Error("Digest do metadado divergente.");
  return JSON.parse(raw.toString());
}
function descritor(d, tipo) {
  if (!d || d.mediaType !== tipo || !DIGEST.test(d.digest) || !Number.isSafeInteger(d.size) || d.size <= 0 || Object.hasOwn(d, "urls")) throw Error("Descritor OCI desconhecido.");
}
function blobJson(metadados, d, tipo) {
  descritor(d, tipo);
  return jsonMetadados(metadados, "blobs/sha256/" + d.digest.slice(7), d);
}
function objetoOCI(valor, tipo) {
  if (valor?.schemaVersion !== 2 || valor.mediaType !== tipo) throw Error("Formato OCI desconhecido.");
}
function configuracao(metadados, d, arquitetura, sistema) {
  const config = blobJson(metadados, d, CONFIG);
  if (config.architecture !== arquitetura || config.os !== sistema || config.rootfs?.type !== "layers" ||
      !Array.isArray(config.rootfs.diff_ids) || config.rootfs.diff_ids.some(id => !DIGEST.test(id))) throw Error("Configuração OCI divergente.");
  return config.rootfs.diff_ids;
}
// OCI 1.1 / BuildKit artifact: valida o conteúdo original, sem fabricar configuração/rootfs.
function atestacaoVazia(metadados, a, plataforma) {
  const config = blobJson(metadados, a.config, EMPTY);
  if (a.config.digest !== EMPTY_DIGEST || a.config.size !== 2 ||
      (Object.hasOwn(a.config, "data") && a.config.data !== "e30=") ||
      !config || Array.isArray(config) || typeof config !== "object" || Object.keys(config).length ||
      a.artifactType !== "application/vnd.docker.attestation.manifest.v1+json") throw Error("Configuração vazia de atestação divergente.");
  descritor(a.subject, MANIFEST);
  if (a.subject.digest !== plataforma.digest || a.subject.size !== plataforma.size ||
      (Object.hasOwn(a.subject, "data") && a.subject.data !== metadados["blobs/sha256/" + plataforma.digest.slice(7)].base64)) throw Error("Subject de atestação divergente.");
  for (const l of a.layers) {
    const prova = blobJson(metadados, l, IN_TOTO);
    if ((Object.hasOwn(l, "data") && l.data !== metadados["blobs/sha256/" + l.digest.slice(7)].base64) ||
        l.annotations?.["in-toto.io/predicate-type"] !== SLSA || prova?._type !== "https://in-toto.io/Statement/v1" ||
        prova.predicateType !== SLSA || !prova.predicate || typeof prova.predicate !== "object" || Array.isArray(prova.predicate) ||
        !Array.isArray(prova.subject) || prova.subject.length !== 1 || typeof prova.subject[0]?.name !== "string" || !prova.subject[0].name ||
        prova.subject[0].digest?.sha256 !== plataforma.digest.slice(7) ||
        JSON.stringify(Object.keys(prova.subject[0].digest)) !== JSON.stringify(["sha256"])) throw Error("Proveniência SLSA divergente.");
  }
}
function identidadeOCI(metadados, d, imagem, manifesto, permitirAtestacaoVazia) {
  if (d.digest !== imagem.id || d.annotations?.["io.containerd.image.name"] !== "docker.io/library/" + imagem.tag ||
      d.annotations?.["org.opencontainers.image.ref.name"] !== imagem.tag.split(":")[1]) throw Error("Identidade do índice OCI divergente.");
  const indice = blobJson(metadados, d, INDEX); objetoOCI(indice, INDEX);
  if (!Array.isArray(indice.manifests) || indice.manifests.length < 1 || indice.manifests.length > 2) throw Error("Plataformas OCI não previstas.");
  const plataformas = indice.manifests.filter(p => p.platform?.os === "linux" && p.platform.architecture === "amd64");
  if (plataformas.length !== 1) throw Error("Plataforma OCI ambígua.");
  const plataforma = plataformas[0], m = blobJson(metadados, plataforma, MANIFEST); objetoOCI(m, MANIFEST);
  const diffIds = configuracao(metadados, m.config, "amd64", "linux");
  if (!Array.isArray(m.layers) || m.layers.length < 1 || m.layers.length > 128 || m.layers.length !== diffIds.length) throw Error("Layers OCI divergentes.");
  const caminhos = m.layers.map(l => { descritor(l, "application/vnd.oci.image.layer.v1.tar+gzip"); const nome = "blobs/sha256/" + l.digest.slice(7); entrada(metadados, nome, l); return nome; });
  if (manifesto.Config !== "blobs/sha256/" + m.config.digest.slice(7) || JSON.stringify(manifesto.Layers) !== JSON.stringify(caminhos)) throw Error("Manifesto Docker diverge da cadeia OCI.");
  for (const atestacao of indice.manifests.filter(p => p !== plataforma)) {
    if (atestacao.platform?.os !== "unknown" || atestacao.platform.architecture !== "unknown" ||
        atestacao.annotations?.["vnd.docker.reference.type"] !== "attestation-manifest" ||
        atestacao.annotations?.["vnd.docker.reference.digest"] !== plataforma.digest) throw Error("Atestação OCI não prevista.");
    const a = blobJson(metadados, atestacao, MANIFEST); objetoOCI(a, MANIFEST);
    if (!Array.isArray(a.layers) || a.layers.length < 1 || a.layers.length > 4) throw Error("Layers de atestação divergentes.");
    if (permitirAtestacaoVazia && (a.config?.mediaType === EMPTY || Object.hasOwn(a, "artifactType") || Object.hasOwn(a, "subject"))) {
      atestacaoVazia(metadados, a, plataforma);
    } else {
      if (JSON.stringify(configuracao(metadados, a.config, "unknown", "unknown")) !== JSON.stringify(a.layers.map(l => l.digest))) throw Error("Configuração de atestação divergente.");
      for (const l of a.layers) blobJson(metadados, l, IN_TOTO);
    }
  }
  return { ...imagem, configId: m.config.digest, manifestId: plataforma.digest, formato: "OCI_INDEX_V1", diffIds };
}
export function validarManifesto(manifesto, esperado, metadados, opcoes = {}) {
  if (!Array.isArray(manifesto) || manifesto.length !== esperado.imagens.length ||
      manifesto.some(i => !Array.isArray(i.RepoTags) || i.RepoTags.length !== 1)) throw Error("Manifesto de imagens inesperado.");
  const tags = manifesto.map(i => i.RepoTags[0]).sort();
  if (JSON.stringify(tags) !== JSON.stringify(esperado.imagens.map(i => i.tag).sort())) throw Error("Tags do arquivo divergentes.");
  const oci = Object.hasOwn(metadados, "index.json") || Object.hasOwn(metadados, "oci-layout");
  let indice;
  if (oci) {
    if (jsonMetadados(metadados, "oci-layout").imageLayoutVersion !== "1.0.0") throw Error("Layout OCI desconhecido.");
    indice = jsonMetadados(metadados, "index.json"); objetoOCI(indice, INDEX);
    if (!Array.isArray(indice.manifests) || indice.manifests.length !== esperado.imagens.length) throw Error("Inventário OCI divergente.");
  }
  return esperado.imagens.map(imagem => {
    const m = manifesto.find(i => i.RepoTags[0] === imagem.tag);
    if (oci) {
      const alvos = indice.manifests.filter(d => d.annotations?.["io.containerd.image.name"] === "docker.io/library/" + imagem.tag);
      if (alvos.length !== 1) throw Error("Tag OCI ausente ou ambígua.");
      return identidadeOCI(metadados, alvos[0], imagem, m, opcoes?.permitirAtestacaoVazia === true);
    }
    if (m.Config !== imagem.id.slice(7) + ".json") throw Error("Formato Docker desconhecido.");
    const config = jsonMetadados(metadados, m.Config);
    if (metadados[m.Config].sha256 !== imagem.id.slice(7) || config.os !== "linux" || config.architecture !== "amd64" ||
        config.rootfs?.type !== "layers" || !Array.isArray(config.rootfs.diff_ids) || config.rootfs.diff_ids.some(id => !DIGEST.test(id)) ||
        !Array.isArray(m.Layers) || m.Layers.length !== config.rootfs.diff_ids.length || !m.Layers.length) throw Error("Identidade Docker divergente.");
    for (const layer of m.Layers) entrada(metadados, layer);
    return { ...imagem, configId: imagem.id, formato: "DOCKER_CONFIG_V1", diffIds: config.rootfs.diff_ids };
  });
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
const ETAPAS = new Set(["configuracao", "transferencia", "arquivo", "metadados", "carregar", "identidade", "render", "comprovante"]);
export function diagnosticoSeguro(erro, padrao = "configuracao") {
  return ETAPAS.has(erro?.etapa) ? erro.etapa : ETAPAS.has(padrao) ? padrao : "configuracao";
}
export async function validarRestauracao(arquivo, esperado, executar = execFileSync, conferir = conferirArquivo) {
  let etapa = "arquivo";
  try {
    await conferir(arquivo, esperado);
    etapa = "metadados";
    const metadados = extrairMetadados(arquivo, executar);
    const identidades = validarManifesto(jsonMetadados(metadados, "manifest.json"), esperado, metadados);
    etapa = "carregar";
    executar("docker", ["load", "--input", arquivo], { timeout: 600_000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    const identidadesRestauradas = [];
    for (const imagem of identidades) {
      etapa = "identidade";
      const restauradas = JSON.parse(executar("docker", ["image", "inspect", imagem.tag], { timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] }).toString());
      const r = restauradas[0];
      // containerd identifica o índice; o store clássico identifica sua configuração.
      if (restauradas.length !== 1 || ![imagem.id, imagem.configId].includes(r.Id) || r.Os !== "linux" || r.Architecture !== "amd64" ||
        JSON.stringify(r.RootFS?.Layers) !== JSON.stringify(imagem.diffIds) || JSON.stringify(r.RepoTags) !== JSON.stringify([imagem.tag])) throw Error("Identidade restaurada divergente.");
      identidadesRestauradas.push({ tag: imagem.tag, idOriginal: imagem.id, configId: imagem.configId, idRestaurado: r.Id, formato: imagem.formato });
      etapa = "render";
      const resposta = executar("docker", argumentosSmoke(imagem.tag), { timeout: 600_000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
      validarSmoke(resposta.toString());
    }
    return { formato: 1, ...esperado, identidadesRestauradas, restauracaoIsoladaValidada: true, renderSinteticoValidado: true };
  } catch { throw Object.assign(Error("Restauração não comprovada."), { etapa }); }
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
    identidadesRestauradas: r.identidadesRestauradas?.map(i => ({ tag: i.tag, idOriginal: i.idOriginal, configId: i.configId, idRestaurado: i.idRestaurado, formato: i.formato })),
    restauracaoIsoladaValidada: r.restauracaoIsoladaValidada, renderSinteticoValidado: r.renderSinteticoValidado,
    repositorio: contexto.repositorio, workflow: "validar-arquivos-workers.yml",
    commit: contexto.commit, runId: contexto.runId, somenteLeituraVPS: true };
  return cifrar(Buffer.from(JSON.stringify(prova)), publica);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await principal();
async function principal() {
  let privado, etapa = "configuracao";
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
        etapa = "transferencia";
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
        etapa = "comprovante";
        const contexto = { repositorio: process.env.GITHUB_REPOSITORY, commit: process.env.GITHUB_SHA, runId: Number(process.env.GITHUB_RUN_ID) };
        const envelope = cifrarProva(r, contexto, process.env.RELATORIO_CHAVE_PUBLICA);
        writeFileSync(process.argv[2], JSON.stringify(envelope), { flag: "wx", mode: 0o600 });
      },
    }, esperado);
    console.log("Arquivo restaurado e renderizado sem rede. A cópia da VPS continua preservada; nenhum descarte foi executado.");
  } catch (erro) {
    console.error("Restauração não comprovada na etapa " + diagnosticoSeguro(erro, etapa) + "; não remover nenhum arquivo da VPS.");
    process.exitCode = 1;
  } finally {
    if (privado) rmSync(privado, { recursive: true, force: true });
  }
}
