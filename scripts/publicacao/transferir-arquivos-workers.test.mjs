import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { constants, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { cifrarProva, conferirArquivo, executarFluxo, selecionar, validarManifesto, validarRestauracao } from "./transferir-arquivos-workers.mjs";
import { decifrar } from "./cifrar-relatorio.mjs";

const esperado = { arquivo: "workers-123.tar.gz", bytes: 8, sha256: "a".repeat(64),
  imagens: ["a", "b"].map(c => ({ tag: "worker:" + c, id: "sha256:" + c.repeat(64) })) };
const manifesto = esperado.imagens.map(i => ({ Config: i.id.slice(7) + ".json", RepoTags: [i.tag] }));
const smoke = JSON.stringify({ concluido: true, preset: "black-vertical-v1", largura: 720, altura: 1280, audio: true, duracao: 0.5 });
const prova = { formato: 1, ...esperado, restauracaoIsoladaValidada: true, renderSinteticoValidado: true };

test("seleciona um arquivo revisado, sem caminho calculado ou alvo extra", () => {
  assert.deepEqual(selecionar(esperado.arquivo, { [esperado.arquivo]: esperado }), esperado);
  for (const invalido of [undefined, "../.env", "__proto__", esperado.arquivo + ".json"]) {
    assert.throws(() => selecionar(invalido, { [esperado.arquivo]: esperado }));
  }
});

test("manifesto exige todas as imagens, digest completo e somente suas tags", () => {
  validarManifesto(manifesto, esperado);
  validarManifesto(manifesto.map(i => ({ ...i, Config: "blobs/sha256/" + i.Config.slice(0, -5) })), esperado);
  for (const invalido of [[], [...manifesto, manifesto[0]],
    manifesto.map((i, n) => n ? i : { ...i, RepoTags: [...i.RepoTags, "app:atual"] }),
    manifesto.map((i, n) => n ? i : { ...i, Config: "c".repeat(64) + ".json" })]) {
    assert.throws(() => validarManifesto(invalido, esperado));
  }
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

test("cada imagem exige inspect e render isolado após carregar", async () => {
  const chamadas = [];
  const executar = (bin, args) => {
    chamadas.push([bin, args]);
    if (bin === "tar") return Buffer.from(JSON.stringify(manifesto));
    if (args[0] === "load") return Buffer.from("carregado");
    if (args[0] === "image") {
      const i = esperado.imagens.find(i => i.tag === args[2]);
      return Buffer.from(JSON.stringify([{ Id: i.id, RepoTags: [i.tag] }]));
    }
    assert.equal(args[args.indexOf("--network") + 1], "none");
    assert.equal(args[args.indexOf("--entrypoint") + 1], "node");
    for (const proibido of ["-v", "--env-file", "--mount", "--privileged"]) assert.ok(!args.includes(proibido));
    return Buffer.from(smoke);
  };
  assert.deepEqual(await validarRestauracao("fixture", esperado, executar, async () => {}), prova);
  assert.deepEqual(chamadas.map(([bin, args]) => bin === "tar" ? "manifesto" : args[0]), ["manifesto", "load", "image", "run", "image", "run"]);
});

test("falhas de hash, manifesto, load, identidade ou render nunca registram sucesso", async () => {
  for (const falha of ["conferir", "manifesto", "load", "image", "run"]) {
    let registrado = false;
    await assert.rejects(executarFluxo({
      transferir: async () => "fixture",
      validar: () => validarRestauracao("fixture", esperado, (bin, args) => {
        const etapa = bin === "tar" ? "manifesto" : args[0];
        if (etapa === falha) throw Error("Falha sintética");
        if (etapa === "manifesto") return Buffer.from(JSON.stringify(manifesto));
        if (etapa === "load") return Buffer.from("carregado");
        if (etapa === "image") return Buffer.from(JSON.stringify([{ Id: esperado.imagens[0].id, RepoTags: [esperado.imagens[0].tag] }]));
        return Buffer.from(smoke);
      }, async () => { if (falha === "conferir") throw Error("Hash sintético divergente"); }),
      registrar: async () => { registrado = true; },
    }, esperado));
    assert.equal(registrado, false);
  }
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
  assert.ok(!Object.hasOwn(revelado, "dadoForaDoEscopo"));
  assert.throws(() => cifrarProva(prova, contexto, undefined));
  const workflow = readFileSync(new URL("../../.github/workflows/validar-arquivos-workers.yml", import.meta.url), "utf8");
  assert.match(workflow, /retention-days: 1\b/);
  assert.match(workflow, /path:.*restauracao-arquivo-workers\.cifrado\.json/);
  assert.ok(!workflow.includes("remover-copia-vps"));
});
