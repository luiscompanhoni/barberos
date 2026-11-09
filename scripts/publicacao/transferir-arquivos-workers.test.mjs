import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { constants, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { cifrarProva, conferirArquivo, diagnosticoSeguro, executarFluxo, extrairMetadados, selecionar, validarManifesto, validarRestauracao } from "./transferir-arquivos-workers.mjs";
import { decifrar } from "./cifrar-relatorio.mjs";

const INDEX = "application/vnd.oci.image.index.v1+json", MANIFEST = "application/vnd.oci.image.manifest.v1+json";
const CONFIG = "application/vnd.oci.image.config.v1+json", LAYER = "application/vnd.oci.image.layer.v1.tar+gzip";
const hash = raw => createHash("sha256").update(raw).digest("hex");
function adicionar(arquivos, nome, valor) {
  const raw = Buffer.from(JSON.stringify(valor));
  arquivos[nome] = { bytes: raw.length, sha256: hash(raw), base64: raw.toString("base64") };
}
function fixture() {
  const metadados = {}, imagens = [], manifesto = [], indices = [], identidades = [];
  const blob = (valor, mediaType) => {
    const raw = Buffer.from(JSON.stringify(valor)), digest = "sha256:" + hash(raw);
    adicionar(metadados, "blobs/sha256/" + digest.slice(7), valor);
    return { mediaType, digest, size: raw.length };
  };
  const layer = blob({ layer: "sintetico" }, LAYER);
  for (const c of ["a", "b"]) {
    const tag = "worker:" + c, diffIds = ["sha256:" + c.repeat(64)];
    const config = blob({ os: "linux", architecture: "amd64", rootfs: { type: "layers", diff_ids: diffIds } }, CONFIG);
    const plataforma = { ...blob({ schemaVersion: 2, mediaType: MANIFEST, config, layers: [layer] }, MANIFEST), platform: { os: "linux", architecture: "amd64" } };
    const aprova = blob({ provenance: "sintetica" }, "application/vnd.in-toto+json");
    const aconfig = blob({ os: "unknown", architecture: "unknown", rootfs: { type: "layers", diff_ids: [aprova.digest] } }, CONFIG);
    const atestacao = { ...blob({ schemaVersion: 2, mediaType: MANIFEST, config: aconfig, layers: [aprova] }, MANIFEST),
      platform: { os: "unknown", architecture: "unknown" }, annotations: { "vnd.docker.reference.type": "attestation-manifest", "vnd.docker.reference.digest": plataforma.digest } };
    const indice = { ...blob({ schemaVersion: 2, mediaType: INDEX, manifests: [plataforma, atestacao] }, INDEX),
      annotations: { "io.containerd.image.name": "docker.io/library/" + tag, "org.opencontainers.image.ref.name": c } };
    imagens.push({ tag, id: indice.digest }); indices.push(indice);
    manifesto.push({ Config: "blobs/sha256/" + config.digest.slice(7), RepoTags: [tag], Layers: ["blobs/sha256/" + layer.digest.slice(7)] });
    identidades.push({ tag, id: indice.digest, configId: config.digest, manifestId: plataforma.digest, formato: "OCI_INDEX_V1", diffIds });
  }
  adicionar(metadados, "manifest.json", manifesto);
  adicionar(metadados, "index.json", { schemaVersion: 2, mediaType: INDEX, manifests: indices });
  adicionar(metadados, "oci-layout", { imageLayoutVersion: "1.0.0" });
  return { metadados, manifesto, identidades, esperado: { arquivo: "workers-123.tar.gz", bytes: 8, sha256: "a".repeat(64), imagens } };
}
const f = fixture(), { esperado, manifesto, metadados } = f;
const smoke = JSON.stringify({ concluido: true, preset: "black-vertical-v1", largura: 720, altura: 1280, audio: true, duracao: 0.5 });
const prova = { formato: 1, ...esperado, identidadesRestauradas: f.identidades.map(i => ({ tag: i.tag, idOriginal: i.id, configId: i.configId, idRestaurado: i.id, formato: i.formato })),
  restauracaoIsoladaValidada: true, renderSinteticoValidado: true };
const clonar = x => JSON.parse(JSON.stringify(x));
const ler = (m, nome) => JSON.parse(Buffer.from(m[nome].base64, "base64"));

// Recria os digests de todo o grafo para testar semântica, além de detectar bytes adulterados.
function fixtureVazia({ alterarAtestacao = () => {}, alterarProva = () => {}, alterarPrincipal = () => {}, layerContent = { layer: "sintetica" } } = {}) {
  const m = {}, tag = "app:historico", diffIds = ["sha256:" + "c".repeat(64)];
  const blob = (valor, mediaType) => {
    const raw = Buffer.from(JSON.stringify(valor)), digest = "sha256:" + hash(raw);
    adicionar(m, "blobs/sha256/" + digest.slice(7), valor);
    return { mediaType, digest, size: raw.length };
  };
  const layer = blob(layerContent, LAYER);
  const principal = { os: "linux", architecture: "amd64", rootfs: { type: "layers", diff_ids: diffIds } };
  alterarPrincipal(principal);
  const config = blob(principal, CONFIG);
  const plataforma = { ...blob({ schemaVersion: 2, mediaType: MANIFEST, config, layers: [layer] }, MANIFEST), platform: { os: "linux", architecture: "amd64" } };
  const slsa = { _type: "https://in-toto.io/Statement/v1", predicateType: "https://slsa.dev/provenance/v1",
    subject: [{ name: "pkg:docker/app@historico?platform=linux%2Famd64", digest: { sha256: plataforma.digest.slice(7) } }], predicate: { buildDefinition: {} } };
  alterarProva(slsa);
  const conteudo = { ...blob(slsa, "application/vnd.in-toto+json"), annotations: { "in-toto.io/predicate-type": "https://slsa.dev/provenance/v1" } };
  const vazio = { ...blob({}, "application/vnd.oci.empty.v1+json"), data: "e30=" };
  const a = { schemaVersion: 2, mediaType: MANIFEST, artifactType: "application/vnd.docker.attestation.manifest.v1+json",
    config: vazio, subject: { mediaType: plataforma.mediaType, digest: plataforma.digest, size: plataforma.size }, layers: [conteudo] };
  alterarAtestacao(a, { blob, plataforma, metadados: m });
  const atestacao = { ...blob(a, MANIFEST), platform: { os: "unknown", architecture: "unknown" },
    annotations: { "vnd.docker.reference.type": "attestation-manifest", "vnd.docker.reference.digest": plataforma.digest } };
  const indice = { ...blob({ schemaVersion: 2, mediaType: INDEX, manifests: [plataforma, atestacao] }, INDEX),
    annotations: { "io.containerd.image.name": "docker.io/library/" + tag, "org.opencontainers.image.ref.name": "historico" } };
  const manifesto = [{ Config: "blobs/sha256/" + config.digest.slice(7), RepoTags: [tag], Layers: ["blobs/sha256/" + layer.digest.slice(7)] }];
  adicionar(m, "manifest.json", manifesto); adicionar(m, "index.json", { schemaVersion: 2, mediaType: INDEX, manifests: [indice] });
  adicionar(m, "oci-layout", { imageLayoutVersion: "1.0.0" });
  return { metadados: m, manifesto, esperado: { imagens: [{ tag, id: indice.digest }] }, configVazia: vazio, conteudo,
    identidades: [{ tag, id: indice.digest, configId: config.digest, manifestId: plataforma.digest, formato: "OCI_INDEX_V1", diffIds }] };
}

test("atestação OCI empty exige opt-in literal; workers continuam usando a configuração estrita", () => {
  const v = fixtureVazia(), permitir = { permitirAtestacaoVazia: true };
  assert.throws(() => validarManifesto(v.manifesto, v.esperado, v.metadados));
  for (const opcoes of [{}, { permitirAtestacaoVazia: false }, { permitirAtestacaoVazia: "true" }]) assert.throws(() => validarManifesto(v.manifesto, v.esperado, v.metadados, opcoes));
  assert.deepEqual(validarManifesto(v.manifesto, v.esperado, v.metadados, permitir), v.identidades);
  assert.deepEqual(validarManifesto(manifesto, esperado, metadados), f.identidades);
  const semData = fixtureVazia({ alterarAtestacao: a => { delete a.config.data; } });
  assert.deepEqual(validarManifesto(semData.manifesto, semData.esperado, semData.metadados, permitir), semData.identidades);
  const inline = fixtureVazia({ alterarAtestacao: (a, { metadados: m }) => {
    a.subject.data = m["blobs/sha256/" + a.subject.digest.slice(7)].base64;
    a.layers[0].data = m["blobs/sha256/" + a.layers[0].digest.slice(7)].base64;
  } });
  assert.deepEqual(validarManifesto(inline.manifesto, inline.esperado, inline.metadados, permitir), inline.identidades);
});

test("empty config, artifactType e subject inválidos falham mesmo com todo o grafo autenticado", () => {
  const alteracoes = [
    a => { a.config.data = "e30=\n"; }, a => { a.config.data = "e30"; }, a => { a.config.data = null; },
    a => { a.config.size = 3; }, a => { a.config.digest = "sha256:" + "d".repeat(64); },
    (a, { blob }) => { a.config = blob({ inesperado: true }, "application/vnd.oci.empty.v1+json"); },
    a => { a.config.urls = ["https://exemplo.invalid/config"]; },
    a => { a.artifactType = "application/vnd.in-toto+json"; }, a => { delete a.artifactType; },
    a => { delete a.subject; }, a => { a.subject.digest = "sha256:" + "d".repeat(64); },
    a => { a.subject.size += 1; }, a => { a.subject.mediaType = INDEX; },
    a => { a.subject.urls = ["https://exemplo.invalid/manifest"]; }, a => { a.subject.data = "e30="; },
    a => { a.layers[0].urls = ["https://exemplo.invalid/provenance"]; }, a => { a.layers[0].mediaType = CONFIG; },
    a => { a.layers[0].data = "e30="; }, a => { a.layers[0].data = null; },
    a => { a.layers[0].annotations["in-toto.io/predicate-type"] = "https://exemplo.invalid/tipo"; },
    // Não reinterpretar artifact como a configuração legacy para fugir de subject/empty.
    (a, { blob }) => { a.config = blob({ os: "unknown", architecture: "unknown", rootfs: { type: "layers", diff_ids: a.layers.map(l => l.digest) } }, CONFIG); },
  ];
  for (const alterarAtestacao of alteracoes) {
    const v = fixtureVazia({ alterarAtestacao });
    assert.throws(() => validarManifesto(v.manifesto, v.esperado, v.metadados, { permitirAtestacaoVazia: true }));
  }
});

test("blobs SLSA mantêm hash, tamanho e subject da plataforma sem normalizar o conteúdo", () => {
  for (const alterarProva of [p => { p._type = "https://in-toto.io/Statement/v0.1"; }, p => { p.predicateType = "outro"; },
    p => { p.subject[0].digest.sha256 = "d".repeat(64); }, p => { p.subject = []; }, p => { p.predicate = null; }]) {
    const v = fixtureVazia({ alterarProva });
    assert.throws(() => validarManifesto(v.manifesto, v.esperado, v.metadados, { permitirAtestacaoVazia: true }));
  }
  for (const campo of ["configVazia", "conteudo"]) for (const adulterar of [e => { e.sha256 = "d".repeat(64); }, e => { e.bytes += 1; },
    e => { e.base64 = Buffer.from("{}").toString("base64"); }]) {
    const v = fixtureVazia(), nome = "blobs/sha256/" + v[campo].digest.slice(7);
    adulterar(v.metadados[nome]);
    // O blob vazio já é '{}': use bytes distintos também nessa adulteração.
    if (campo === "configVazia" && v.metadados[nome].base64 === "e30=" && v.metadados[nome].sha256 === v[campo].digest.slice(7) && v.metadados[nome].bytes === 2) v.metadados[nome].base64 = "W10=";
    assert.throws(() => validarManifesto(v.manifesto, v.esperado, v.metadados, { permitirAtestacaoVazia: true }));
  }
  const rootfs = fixtureVazia({ alterarPrincipal: p => { p.rootfs.type = "desconhecido"; } });
  assert.throws(() => validarManifesto(rootfs.manifesto, rootfs.esperado, rootfs.metadados, { permitirAtestacaoVazia: true }));
});

test("seleciona um arquivo revisado, sem caminho calculado ou alvo extra", () => {
  assert.deepEqual(selecionar(esperado.arquivo, { [esperado.arquivo]: esperado }), esperado);
  for (const invalido of [undefined, "../.env", "__proto__", esperado.arquivo + ".json"]) {
    assert.throws(() => selecionar(invalido, { [esperado.arquivo]: esperado }));
  }
});

test("manifesto exige todas as imagens, digest completo e somente suas tags", () => {
  assert.deepEqual(validarManifesto(manifesto, esperado, metadados), f.identidades);
  assert.notEqual(f.identidades[0].id, f.identidades[0].configId);
  for (const invalido of [[], [...manifesto, manifesto[0]],
    manifesto.map((i, n) => n ? i : { ...i, RepoTags: [...i.RepoTags, "app:atual"] }),
    manifesto.map((i, n) => n ? i : { ...i, Config: "c".repeat(64) + ".json" }),
    manifesto.map((i, n) => n ? i : { ...i, Layers: [] })]) {
    assert.throws(() => validarManifesto(invalido, esperado, metadados));
  }
});

test("índice adulterado, config divergente e formatos desconhecidos falham fechados", () => {
  for (const alterar of [
    m => { const x = ler(m, "index.json"); x.manifests[0].digest = "sha256:" + "c".repeat(64); adicionar(m, "index.json", x); },
    m => { const x = ler(m, "index.json"); x.manifests[0].annotations["org.opencontainers.image.ref.name"] = "outra"; adicionar(m, "index.json", x); },
    m => { const x = ler(m, "index.json"); x.manifests.push(x.manifests[0]); adicionar(m, "index.json", x); },
    m => { const x = ler(m, "index.json"); x.mediaType = "application/desconhecido"; adicionar(m, "index.json", x); },
    m => adicionar(m, "oci-layout", { imageLayoutVersion: "9.0.0" }),
    m => { delete m["index.json"]; },
    m => { const p = "blobs/sha256/" + esperado.imagens[0].id.slice(7); const x = ler(m, p); x.schemaVersion = 3; adicionar(m, p, x); },
    m => { m[manifesto[0].Layers[0]].bytes += 1; },
    m => { delete m[manifesto[0].Layers[0]]; },
    m => { const p = manifesto[0].Config; const x = ler(m, p); x.os = "outro"; adicionar(m, p, x); },
    m => { m[manifesto[0].Config].bytes += 1; },
  ]) {
    const m = clonar(metadados); alterar(m);
    assert.throws(() => validarManifesto(manifesto, esperado, m));
  }
});

test("formato Docker legado continua exigindo digest da configuração", () => {
  const config = { os: "linux", architecture: "amd64", rootfs: { type: "layers", diff_ids: ["sha256:" + "c".repeat(64)] } };
  const id = "sha256:" + hash(Buffer.from(JSON.stringify(config))), m = {};
  adicionar(m, id.slice(7) + ".json", config); m["camada/layer.tar"] = { bytes: 4 };
  const legado = [{ Config: id.slice(7) + ".json", RepoTags: ["worker:a"], Layers: ["camada/layer.tar"] }];
  assert.equal(validarManifesto(legado, { imagens: [{ tag: "worker:a", id }] }, m)[0].formato, "DOCKER_CONFIG_V1");
  assert.throws(() => validarManifesto(legado, { imagens: [{ tag: "worker:a", id: "sha256:" + "d".repeat(64) }] }, m));
});

test("leitor recusa duplicatas, symlink e caminho externo sem extrair", () => {
  const pasta = mkdtempSync(join(tmpdir(), "worker-tar-test-"));
  const python = process.env.PYTHON_TEST_EXECUTABLE || "python3";
  const executar = (_bin, args, opts) => execFileSync(python, args, opts);
  const codigo = String.raw`import base64,io,json,sys,tarfile
arquivos=json.load(sys.stdin)
with tarfile.open(sys.argv[1],"w:gz") as t:
 for nome,entrada in arquivos.items():
  raw=base64.b64decode(entrada.get("base64","")); i=tarfile.TarInfo(nome);i.size=len(raw);t.addfile(i,io.BytesIO(raw))
 if sys.argv[2]!="ok":
  i=tarfile.TarInfo("manifest.json" if sys.argv[2]=="duplicado" else "../externo")
  if sys.argv[2]=="symlink": i.name="link";i.type=tarfile.SYMTYPE;i.linkname="manifest.json"
  t.addfile(i)`;
  try {
    for (const modo of ["ok", "duplicado", "symlink", "externo"]) {
      const arquivo = join(pasta, modo + ".tar.gz");
      execFileSync(python, ["-c", codigo, arquivo, modo], { input: JSON.stringify(metadados), stdio: ["pipe", "pipe", "pipe"] });
      if (modo === "ok") assert.equal(ler(extrairMetadados(arquivo, executar), "oci-layout").imageLayoutVersion, "1.0.0");
      else assert.throws(() => extrairMetadados(arquivo, executar));
    }
  } finally { rmSync(pasta, { recursive: true, force: true }); }
});

test("layer acima de 1 MiB é hasheada em stream; corrupção do mesmo tamanho falha antes do load", async () => {
  const pasta = mkdtempSync(join(tmpdir(), "layer-digest-test-")), python = process.env.PYTHON_TEST_EXECUTABLE || "python3";
  const v = fixtureVazia({ layerContent: { texto: randomBytes(1024 ** 2 + 128).toString("base64") } }), layer = v.manifesto[0].Layers[0];
  const codigo = String.raw`import base64,io,json,sys,tarfile
arquivos=json.load(sys.stdin)
with tarfile.open(sys.argv[1],"w:gz") as tar:
 for nome,e in arquivos.items():
  raw=base64.b64decode(e["base64"])
  if nome==sys.argv[2] and sys.argv[3]=="corromper": raw=b"X"+raw[1:]
  item=tarfile.TarInfo(nome);item.size=len(raw);tar.addfile(item,io.BytesIO(raw))`;
  try {
    for (const modo of ["ok", "corromper"]) {
      const arquivo = join(pasta, modo + ".tar.gz");
      execFileSync(python, ["-c", codigo, arquivo, layer, modo], { input: JSON.stringify(v.metadados), stdio: ["pipe", "pipe", "pipe"] });
      const executar = (bin, args, opts) => { assert.equal(bin, "python3", "Nenhum Docker antes de validar o digest"); return execFileSync(python, args, opts); };
      const m = extrairMetadados(arquivo, executar), raw = readFileSync(arquivo), e = { ...v.esperado, bytes: raw.length, sha256: hash(raw) };
      assert.equal(m[layer].bytes, v.metadados[layer].bytes); assert.ok(m[layer].bytes > 1024 ** 2);
      assert.equal(Object.hasOwn(m[layer], "base64"), false);
      if (modo === "ok") {
        assert.equal(m[layer].sha256, v.metadados[layer].sha256);
        assert.deepEqual(validarManifesto(v.manifesto, e, m, { permitirAtestacaoVazia: true }), v.identidades);
        writeFileSync(join(pasta, "truncado.tar.gz"), raw.subarray(0, Math.floor(raw.length / 2)));
        assert.throws(() => extrairMetadados(join(pasta, "truncado.tar.gz"), executar));
      } else {
        assert.notEqual(m[layer].sha256, v.metadados[layer].sha256);
        assert.throws(() => validarManifesto(v.manifesto, e, m, { permitirAtestacaoVazia: true }), /digest divergente/);
        await assert.rejects(validarRestauracao(arquivo, e, executar, async (a, esperado) => {
          assert.equal(readFileSync(a).length, esperado.bytes); assert.equal(hash(readFileSync(a)), esperado.sha256);
        }), erro => erro.etapa === "metadados");
      }
    }
  } finally { rmSync(pasta, { recursive: true, force: true }); }
});

test("arquivo incompleto ou adulterado recusa restauração", { skip: !constants.O_NOFOLLOW }, async () => {
  const pasta = mkdtempSync(join(tmpdir(), "worker-transfer-test-"));
  try {
    const arquivo = join(pasta, "fixture.gz"), dados = Buffer.from("ficticio");
    const e = { ...esperado, bytes: dados.length, sha256: createHash("sha256").update(dados).digest("hex") };
    writeFileSync(arquivo, dados);
    await conferirArquivo(arquivo, e);
    writeFileSync(arquivo, Buffer.alloc(dados.length));
    await assert.rejects(conferirArquivo(arquivo, e));
    writeFileSync(arquivo, Buffer.from("x"));
    await assert.rejects(conferirArquivo(arquivo, e));
  } finally { rmSync(pasta, { recursive: true, force: true }); }
});

function executor(chamadas, classico = false, adulterar = x => x) {
  return (bin, args) => {
    chamadas.push([bin, args]);
    if (bin === "python3") return Buffer.from(JSON.stringify(metadados));
    if (args[0] === "load") return Buffer.from("carregado");
    if (args[0] === "image") {
      const i = f.identidades.find(i => i.tag === args[2]);
      return Buffer.from(JSON.stringify([adulterar({ Id: classico ? i.configId : i.id, RepoTags: [i.tag], Os: "linux", Architecture: "amd64", RootFS: { Layers: i.diffIds } })]));
    }
    assert.equal(args[args.indexOf("--network") + 1], "none");
    assert.equal(args[args.indexOf("--entrypoint") + 1], "node");
    for (const proibido of ["-v", "--env-file", "--mount", "--privileged"]) assert.ok(!args.includes(proibido));
    return Buffer.from(smoke);
  };
}
test("cada imagem exige cadeia, inspect e render; ambos stores mantêm identidade comprovada", async () => {
  for (const classico of [false, true]) {
    const chamadas = [], r = await validarRestauracao("fixture", esperado, executor(chamadas, classico), async () => {});
    assert.deepEqual(r, { ...prova, identidadesRestauradas: prova.identidadesRestauradas.map(i => ({ ...i, idRestaurado: classico ? i.configId : i.idOriginal })) });
    assert.deepEqual(chamadas.map(([bin, args]) => bin === "python3" ? "metadados" : args[0]), ["metadados", "load", "image", "run", "image", "run"]);
  }
});

test("tag correta com ID arbitrário, plataforma ou layers divergentes não comprova identidade", async () => {
  for (const alterar of [x => ({ ...x, Id: "sha256:" + "f".repeat(64) }), x => ({ ...x, Os: "outro" }),
    x => ({ ...x, Architecture: "arm64" }), x => ({ ...x, RootFS: { Layers: [] } }), x => ({ ...x, RepoTags: [...x.RepoTags, "extra:tag"] })]) {
    await assert.rejects(validarRestauracao("fixture", esperado, executor([], true, alterar), async () => {}), e => e.etapa === "identidade");
  }
});

test("falhas de hash, metadados, load, identidade ou render nunca registram sucesso", async () => {
  for (const falha of ["arquivo", "metadados", "carregar", "identidade", "render"]) {
    let registrado = false;
    const executar = executor([]);
    await assert.rejects(executarFluxo({
      transferir: async () => "fixture",
      validar: () => validarRestauracao("fixture", esperado, (bin, args) => {
        const etapa = bin === "python3" ? "metadados" : { load: "carregar", image: "identidade", run: "render" }[args[0]];
        if (etapa === falha) throw Object.assign(Error("NAO_EXPORTAR"), { stderr: "TOKEN_PRIVADO" });
        return executar(bin, args);
      }, async () => { if (falha === "arquivo") throw Error("NAO_EXPORTAR"); }),
      registrar: async () => { registrado = true; },
    }, esperado), e => e.etapa === falha && !e.message.includes("NAO_EXPORTAR"));
    assert.equal(registrado, false);
  }
  assert.equal(diagnosticoSeguro({ etapa: "TOKEN_PRIVADO", stderr: "NAO_EXPORTAR" }), "configuracao");
  assert.equal(diagnosticoSeguro({}, "TOKEN_PRIVADO"), "configuracao");
});

test("fluxo somente lê e valida; não oferece etapa de remoção", async () => {
  const chamadas = [];
  await executarFluxo({ transferir: async () => { chamadas.push("transferir"); return "fixture"; },
    validar: async () => { chamadas.push("validar"); return prova; },
    registrar: async () => { chamadas.push("registrar"); },
    remover: async () => assert.fail("Não pode remover"),
  }, esperado);
  assert.deepEqual(chamadas, ["transferir", "validar", "registrar"]);
  await assert.rejects(executarFluxo({ transferir: async () => "fixture", validar: async () => ({ ...prova, renderSinteticoValidado: false }),
    registrar: async () => assert.fail("Não pode registrar"),
  }, esperado));
});

test("comprovante público sai somente cifrado e sem campos adicionais", () => {
  const par = generateKeyPairSync("rsa", { modulusLength: 3072 });
  const publica = par.publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const contexto = { repositorio: "luiscompanhoni/barberos", commit: "c".repeat(40), runId: 123 };
  const envelope = cifrarProva({ ...prova, dadoForaDoEscopo: "NAO_EXPORTAR" }, contexto, publica);
  assert.equal(envelope.algoritmo, "RSA-OAEP-SHA256+A256GCM");
  assert.ok(!JSON.stringify(envelope).includes(esperado.arquivo));
  const privada = par.privateKey.export({ type: "pkcs8", format: "pem" });
  const revelado = JSON.parse(decifrar(envelope, privada));
  assert.equal(revelado.arquivo, esperado.arquivo);
  assert.equal(revelado.runId, 123);
  assert.equal(revelado.somenteLeituraVPS, true);
  assert.deepEqual(revelado.identidadesRestauradas, prova.identidadesRestauradas);
  assert.ok(!Object.hasOwn(revelado, "dadoForaDoEscopo"));
  assert.throws(() => cifrarProva(prova, contexto, undefined));
  const workflow = readFileSync(new URL("../../.github/workflows/validar-arquivos-workers.yml", import.meta.url), "utf8");
  assert.match(workflow, /retention-days: 1\b/);
  assert.match(workflow, /path:.*restauracao-arquivo-workers\.cifrado\.json/);
  assert.ok(!workflow.includes("remover-copia-vps"));
});
