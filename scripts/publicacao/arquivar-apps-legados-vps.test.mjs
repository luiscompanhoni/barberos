import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ALVOS, ALVOS_SHA256, APP_ESPERADO, NOMINAIS, codigoAlvos, selecionarAlvo, validarCi, validarPreparacao,
  validarManifestoAliases, argumentosSmoke, validarCopia, executarFluxo } from "./arquivar-apps-legados-vps.mjs";

const clone = structuredClone, hash = b => createHash("sha256").update(b).digest("hex");
const alvo = ALVOS[4], nominal = selecionarAlvo(alvo);
const preparar = (a = alvo) => {
  const n = selecionarAlvo(a);
  return { formato: 2, alvo: a, imagemApp: APP_ESPERADO, arquivo: "workers-1794236115.tar.gz", sha256: "a".repeat(64), bytes: 100,
    imagens: n.tags.map(tag => ({ tag, id: n.id, bytesImagem: n.bytes })) };
};
const prova = antes => ({ alvo: antes.alvo, arquivo: antes.arquivo, sha256: antes.sha256, bytes: antes.bytes, imagens: clone(antes.imagens),
  restauracaoIsoladaValidada: true, aplicacaoSinteticaValidada: true });
const concluir = antes => ({ concluido: true, alvo: antes.alvo, arquivo: "/opt/barberos/worker-archives/" + antes.arquivo, sha256: antes.sha256, bytes: antes.bytes,
  imagensArquivadas: clone(antes.imagens), containersVolumesBackupsConfiguracaoPreservados: true, restauracaoIsoladaValidada: true, aplicacaoSinteticaValidada: true });
const smoke = JSON.stringify({ concluido: true, sintaxeServidorValidada: true, pacotesValidados: ["next", "react"], uid: 1000, gid: 1000 });
const OCI_INDEX = "application/vnd.oci.image.index.v1+json", OCI_MANIFEST = "application/vnd.oci.image.manifest.v1+json";
function fixtureOCI() {
  const metadados = {}, n = clone(nominal);
  function salvar(nome, raw) {
    raw = Buffer.isBuffer(raw) ? raw : Buffer.from(JSON.stringify(raw));
    const e = { bytes: raw.length, sha256: hash(raw), base64: raw.toString("base64") };
    metadados[nome || "blobs/sha256/" + e.sha256] = e;
    return e;
  }
  function blob(objeto, mediaType, extras = {}) {
    const e = salvar(null, objeto);
    return { mediaType, size: e.bytes, digest: "sha256:" + e.sha256, ...extras };
  }
  const layers = n.rootfs.Layers.map((_, i) => blob(Buffer.from("layer" + i), "application/vnd.oci.image.layer.v1.tar+gzip"));
  const config = blob({ os: "linux", architecture: "amd64", rootfs: { type: "layers", diff_ids: n.rootfs.Layers } }, "application/vnd.oci.image.config.v1+json");
  const plataforma = blob({ schemaVersion: 2, mediaType: OCI_MANIFEST, config, layers }, OCI_MANIFEST, { platform: { os: "linux", architecture: "amd64" } });
  const raiz = blob({ schemaVersion: 2, mediaType: OCI_INDEX, manifests: [plataforma] }, OCI_INDEX);
  n.id = raiz.digest;
  const indice = { schemaVersion: 2, mediaType: OCI_INDEX, manifests: n.tags.map(tag => ({ ...raiz, annotations: {
    "io.containerd.image.name": "docker.io/library/" + tag, "org.opencontainers.image.ref.name": tag.split(":")[1] } })) };
  const manifesto = [{ Config: "blobs/sha256/" + config.digest.slice(7), RepoTags: n.tags, Layers: layers.map(l => "blobs/sha256/" + l.digest.slice(7)) }];
  salvar("index.json", indice); salvar("manifest.json", manifesto); salvar("oci-layout", { imageLayoutVersion: "1.0.0" });
  const antes = preparar(); antes.imagens = n.tags.map(tag => ({ tag, id: n.id, bytesImagem: n.bytes }));
  return { n, metadados, antes, manifesto, indice, config, salvar };
}
function executor(opcoes = {}) {
  let carregado = false, consultas = 0;
  const chamadas = [], alheia = { ID: "sha256:" + "d".repeat(64), Repository: "ubuntu", Tag: "teste" };
  const configId = "sha256:" + "c".repeat(64);
  const exec = (cmd, args) => {
    chamadas.push([cmd, args]); assert.equal(cmd, "docker");
    if (args[0] === "image" && args[1] === "ls") {
      consultas++;
      const lista = [alheia];
      if (opcoes.presente && !carregado) lista.push({ ID: opcoes.presente === "config" ? configId : nominal.id, Repository: "barberos-app", Tag: "outra" });
      if (carregado) lista.push(...nominal.tags.map(t => ({ ID: opcoes.classico ? configId : nominal.id, Repository: "barberos-app", Tag: t.split(":")[1] })));
      return Buffer.from((opcoes.perderAlheia && consultas > 1 ? lista.slice(1) : lista).map(i => JSON.stringify(i)).join("\n"));
    }
    if (args[0] === "ps") return Buffer.from(opcoes.container ? "f".repeat(64) : "");
    if (args[0] === "load") { carregado = true; if (opcoes.falharLoad) throw Error("SEGREDO"); return Buffer.from(""); }
    if (args[0] === "image" && args[1] === "inspect") return Buffer.from(JSON.stringify([{ Id: opcoes.classico ? configId : nominal.id,
      Os: "linux", Architecture: "amd64", RootFS: clone(nominal.rootfs), RepoTags: [...nominal.tags].reverse(), Config: { Env: ["PATH=/usr/bin"] }, ...opcoes.inspect }]));
    if (args[0] === "run") return Buffer.from(opcoes.smoke || smoke);
    throw Error("Comando inesperado");
  };
  const imagem = { configId, manifestId: "sha256:" + "b".repeat(64), formato: "OCI_INDEX_V1", diffIds: nominal.rootfs.Layers };
  return { exec, chamadas, validar: () => validarCopia(preparar(), "/privado/copia", exec, async () => {}, () => ({}), undefined, () => imagem) };
}

test("fonte única fecha sete IDs e todos os aliases, sem incluir configuração privada", () => {
  assert.equal(hash(codigoAlvos), ALVOS_SHA256); assert.equal(ALVOS.length, 7);
  assert.equal(new Set(NOMINAIS.alvos.map(n => n.id)).size, 7);
  assert.equal(new Set(NOMINAIS.alvos.flatMap(n => n.tags)).size, NOMINAIS.alvos.flatMap(n => n.tags).length);
  assert.equal(nominal.tags.length, 3); assert.ok(nominal.tags.includes("barberos-app:latest"));
  assert.equal(hash(readFileSync(new URL("./arquivar_workers.py", import.meta.url))), NOMINAIS.canonicoSha256);
  assert.ok(!codigoAlvos.includes("configuracoesHashes")); assert.throws(() => selecionarAlvo("qualquer"));
  for (const a of ALVOS) validarPreparacao(preparar(a), a);
});
test("preparação recusa alvo trocado, alias ausente, extra, duplicado, id ou bytes divergentes", () => {
  for (const alterar of [r => r.imagens.pop(), r => r.imagens.push(r.imagens[0]), r => r.imagens[0].tag = "barberos-app:intruso",
    r => r.imagens[0].id = "sha256:" + "f".repeat(64), r => r.imagens[0].bytesImagem++, r => r.imagemApp = "outra",
    r => r.arquivo = "../workers-1.tar.gz", r => r.bytes = 2_000_000_001, r => r.sha256 = "G".repeat(64)]) {
    const r = preparar(); alterar(r); assert.throws(() => validarPreparacao(r));
  }
  assert.throws(() => validarPreparacao(preparar(ALVOS[0]), alvo));
});
test("CI exige push concluído com sucesso no SHA exato da main", () => {
  const env = { GITHUB_REF: "refs/heads/main", GITHUB_SHA: "a".repeat(40) };
  const run = { headSha: env.GITHUB_SHA, headBranch: "main", event: "push", status: "completed", conclusion: "success" };
  validarCi([run], env);
  for (const delta of [{ event: "workflow_dispatch" }, { headSha: "b".repeat(40) }, { headBranch: "outra" }, { status: "in_progress" }, { conclusion: "failure" }]) assert.throws(() => validarCi([{ ...run, ...delta }], env));
  assert.throws(() => validarCi([run], { ...env, GITHUB_REF: "refs/heads/teste" }));
});
test("aliases agrupados restauram a mesma cadeia OCI autenticada sem fabricar configuração", () => {
  const f = fixtureOCI(), resultado = validarManifestoAliases(f.antes, f.metadados, f.n);
  assert.equal(resultado.id, f.n.id); assert.equal(resultado.configId, f.config.digest);
  assert.deepEqual(resultado.diffIds, nominal.rootfs.Layers);
  f.salvar("manifest.json", f.n.tags.map(tag => ({ ...f.manifesto[0], RepoTags: [tag] })));
  assert.equal(validarManifestoAliases(f.antes, f.metadados, f.n).configId, f.config.digest);
});
test("aliases não autenticam inventário extra, divergente ou duplicado", () => {
  for (const alterar of [f => { f.manifesto[0].RepoTags = f.n.tags.slice(1); f.salvar("manifest.json", f.manifesto); },
    f => { f.manifesto[0].RepoTags = [...f.n.tags, f.n.tags[0]]; f.salvar("manifest.json", f.manifesto); },
    f => { f.indice.manifests[1].digest = "sha256:" + "f".repeat(64); f.salvar("index.json", f.indice); },
    f => { f.indice.manifests[1].annotations["org.opencontainers.image.ref.name"] = "intruso"; f.salvar("index.json", f.indice); },
    f => { f.salvar("blobs/sha256/" + "f".repeat(64), Buffer.from("imagem alheia")); },
    f => { f.metadados["manifest.json"].sha256 = "f".repeat(64); },
    f => { f.metadados["blobs/sha256/" + f.config.digest.slice(7)].base64 = Buffer.from("{}").toString("base64"); },
    f => { f.n.rootfs.Layers[0] = "sha256:" + "f".repeat(64); },
    f => { f.salvar("manifest.json", [f.manifesto[0], { ...f.manifesto[0], RepoTags: [], Layers: [] }]); }]) {
    const f = fixtureOCI(); alterar(f); assert.throws(() => validarManifestoAliases(f.antes, f.metadados, f.n));
  }
});
test("smoke só verifica sintaxe sem entrypoint, rede, privilégios, volumes ou migrations", () => {
  const args = argumentosSmoke(nominal.tags[0]);
  for (const v of ["--rm", "--pull=never", "--network", "none", "--user", "1000:1000", "--read-only", "--cap-drop", "ALL", "no-new-privileges:true", "--entrypoint", "node", nominal.tags[0]]) assert.ok(args.includes(v));
  assert.ok(args.at(-1).includes('["--check", "/app/server.js"]'));
  assert.ok(!args.some(v => /prisma|migrate|--volume|--env-file|--privileged/.test(v)));
});
test("restauração exige todos os aliases e preserva imagens alheias; OCI e store clássico", async () => {
  for (const classico of [false, true]) {
    const e = executor({ classico }), r = await e.validar();
    assert.deepEqual(r.imagens, preparar().imagens); assert.equal(r.executor.imagensPreexistentesPreservadas, true);
    assert.equal(e.chamadas.filter(([, a]) => a[0] === "image" && a[1] === "inspect").length, nominal.tags.length);
    assert.equal(e.chamadas.filter(([, a]) => a[0] === "run").length, 1);
    assert.ok(e.chamadas.every(([, a]) => !["rm", "rmi", "prune", "up", "push"].some(c => a.includes(c))));
  }
});
test("executor com imagem nominal/config existente ou qualquer contêiner recusa antes do load", async () => {
  for (const opcoes of [{ presente: "id" }, { presente: "config" }, { container: true }]) {
    const e = executor(opcoes); await assert.rejects(e.validar(), r => r.etapa === "executor" && ["alvo_presente", "containers_presentes"].includes(r.diagnosticoExecutor));
    assert.ok(e.chamadas.every(([, a]) => a[0] !== "load"));
  }
});
test("load, identidade, alias faltante, preload, smoke ou perda de imagem não geram prova", async () => {
  for (const opcoes of [{ falharLoad: true }, { inspect: { RepoTags: nominal.tags.slice(1) } }, { inspect: { Id: "sha256:" + "f".repeat(64) } },
    { inspect: { RootFS: { ...nominal.rootfs, Layers: [] } } }, { inspect: { Config: { Env: ["NODE_OPTIONS=--require\n/tmp/a"] } } },
    { smoke: "{}" }, { perderAlheia: true }]) await assert.rejects(executor(opcoes).validar(), r => r.message === "Restauração do app não comprovada." && !r.message.includes("SEGREDO"));
});
test("erro do arquivo ou do parser impede qualquer comando Docker", async () => {
  for (const etapa of ["arquivo", "metadados"]) {
    const chamadas = [];
    await assert.rejects(validarCopia(preparar(), "/copia", (...a) => chamadas.push(a), async () => { if (etapa === "arquivo") throw Error(); }, () => ({}), undefined,
      () => { throw Error(); }), r => r.etapa === etapa);
    assert.deepEqual(chamadas, []);
  }
});
test("remoção só recebe prova exata vinculada a arquivo, alvo, hash, bytes e aliases", async () => {
  const antes = preparar(), ordem = [];
  const r = await executarFluxo({ preparar: () => { ordem.push("preparar"); return antes; }, transferir: () => { ordem.push("transferir"); return "/copia"; },
    validar: () => { ordem.push("validar"); return prova(antes); }, concluir: (a, p) => { ordem.push("concluir"); assert.deepEqual(p, prova(antes)); return concluir(a); } }, alvo);
  assert.equal(r.concluido, true); assert.deepEqual(ordem, ["preparar", "transferir", "validar", "concluir"]);
  for (const alterar of [p => p.alvo = ALVOS[0], p => p.arquivo = "workers-2.tar.gz", p => p.sha256 = "b".repeat(64), p => p.bytes++, p => p.imagens.pop(),
    p => p.restauracaoIsoladaValidada = false, p => p.aplicacaoSinteticaValidada = false]) {
    let removeu = false; const p = prova(antes); alterar(p);
    await assert.rejects(executarFluxo({ preparar: () => antes, transferir: () => "/copia", validar: () => p, concluir: () => { removeu = true; } }, alvo));
    assert.equal(removeu, false);
  }
});
test("conclusão sem preservação, aliases ou recuperação integral não anuncia sucesso", async () => {
  const antes = preparar();
  for (const alterar of [r => r.imagensArquivadas.pop(), r => r.containersVolumesBackupsConfiguracaoPreservados = false,
    r => r.aplicacaoSinteticaValidada = false, r => r.restauracaoIsoladaValidada = false, r => r.arquivo = "/outro/" + antes.arquivo, r => r.sha256 = "b".repeat(64)]) {
    const r = concluir(antes); alterar(r);
    await assert.rejects(executarFluxo({ preparar: () => antes, transferir: () => "/copia", validar: () => prova(antes), concluir: () => r }, alvo));
  }
});
test("workflow protege main/SHA, testa antes do SSH e publica apenas recibo cifrado por um dia", () => {
  const yml = readFileSync(new URL("../../.github/workflows/arquivar-apps-legados-vps.yml", import.meta.url), "utf8");
  const opcoes = yml.match(/options:\n([\s\S]*?)      imagem_anterior:/)[1].match(/- ([^\n]+)/g).map(l => l.slice(2));
  assert.deepEqual(opcoes, ALVOS); assert.ok(yml.includes(APP_ESPERADO));
  for (const parte of ["github.ref == 'refs/heads/main'", "ref: ${{ github.sha }}", "persist-credentials: false", "--workflow ci.yml --commit", "--branch main --event push",
    "group: publicacao-producao", "cancel-in-progress: false", "ARQUIVAMENTO_CI_JSON:", "retention-days: 1", "if-no-files-found: error"]) assert.ok(yml.includes(parte), parte);
  assert.ok(yml.indexOf("Exigir CI push") < yml.indexOf("VPS_SSH_KEY:"));
  const paths = [...yml.matchAll(/^          path: (.+)$/gm)].map(m => m[1]);
  assert.deepEqual(paths, ["${{ runner.temp }}/apps-legados-arquivamento.cifrado.json"]);
  assert.ok(!yml.includes(".tar.gz"));
});
test("chave inválida ou CI ausente impedem arquivo de recibo e qualquer SSH", () => {
  const pasta = mkdtempSync(join(tmpdir(), "barberos-apps-guard-"));
  try {
    const ci = join(pasta, "ci.json"), recibo = join(pasta, "recibo.json");
    const sha = "a".repeat(40); writeFileSync(ci, JSON.stringify([{ headSha: sha, headBranch: "main", event: "push", status: "completed", conclusion: "success" }]));
    const env = { ...process.env, PATH: "", GITHUB_ACTIONS: "true", RUNNER_OS: "Linux", GITHUB_REF: "refs/heads/main", GITHUB_SHA: sha,
      DOCKER_HOST: "", DOCKER_CONTEXT: "", ARQUIVAMENTO_ALVO: alvo, ARQUIVAMENTO_CI_JSON: ci, VPS_IMAGEM_ANTERIOR: APP_ESPERADO,
      RELATORIO_CHAVE_PUBLICA: "invalida", VPS_HOST: "host.invalid", VPS_USER: "usuario", VPS_SSH_KEY: "SEGREDO", VPS_KNOWN_HOSTS: "SEGREDO" };
    const caminho = fileURLToPath(new URL("./arquivar-apps-legados-vps.mjs", import.meta.url));
    for (const delta of [{}, { ARQUIVAMENTO_CI_JSON: "ausente" }, { ARQUIVAMENTO_ALVO: "nao-autorizado" }]) {
      const r = spawnSync(process.execPath, [caminho, recibo], { encoding: "utf8", env: { ...env, ...delta } });
      assert.equal(r.status, 1); assert.equal(existsSync(recibo), false); assert.equal(r.stdout, ""); assert.ok(!r.stderr.includes("SEGREDO"));
    }
  } finally { rmSync(pasta, { recursive: true, force: true }); }
});
