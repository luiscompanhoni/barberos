import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { decifrar } from "./cifrar-relatorio.mjs";
import { ALVOS, APP_ESPERADO, argumentosSmoke, comprovanteCifrado, executarFluxo, selecionarAlvo,
  validarCopia, validarPreparacao, validarRestauracao, validarSmoke } from "./arquivar-workers-vps.mjs";

const alvo = Object.keys(ALVOS)[0];
const imagem = { tag: "barberos-video-worker:" + alvo, ...ALVOS[alvo] };
const conteudo = Buffer.from("arquivo de imagem sintético");
const preparado = () => ({ formato: 2, alvo, imagemApp: APP_ESPERADO, arquivo: "workers-123.tar.gz",
  bytes: conteudo.length, sha256: createHash("sha256").update(conteudo).digest("hex"), imagens: [imagem] });
const smoke = { concluido: true, preset: "black-vertical-v1", largura: 720, altura: 1280, audio: true, duracao: 0.5 };

test("inventário nominal de novembro preserva legados, app instalado e tamanhos do inspect", () => {
  assert.equal(APP_ESPERADO, "sha256:e0dad14729fb9dc7293d8ea0f0915748cb9a872a8d84e0a56148bdbd0898a477");
  const novos = {
    deb1ecce366410404d3e2d403f9e091538a95975: { id: "sha256:844476ff7385a16cd510f3baeae80ea7de8bf581e745f48df60dc744603844f4", bytesImagem: 1779238343 },
    "0367c9d1be036ad0433fbb53e447c2a0afdda3cb": { id: "sha256:5988b33b1dbceb72fc3d496809a716f4423eae0df2dbb31a01c57c5a412e4678", bytesImagem: 1779227102 },
    "8a5566dc6c095090f23dbb72384c92b4e79de81c": { id: "sha256:941d7d1458eb7085accb59aaf6e1e0b4c2af3c6dae17aa9e59d46a717a33de66", bytesImagem: 1779271754 },
  };
  assert.deepEqual(Object.keys(ALVOS).sort(), ["d833182db751a74d3ce52017f11a2824fcb6c735", "7f8c8f2e3dc77a1ffe39e01fc4cf1c00a752dd10", "7efefa8daf285b2b46b8bb9d8e57663c2a2b6a8a", ...Object.keys(novos)].sort());
  for (const protegida of ["102a3911fd6b38c635af9cf9cb7718e04f0796db", "d10b3b1c7be93faa9f5433732a18a2602620bf25"]) assert.throws(() => selecionarAlvo(protegida));
  const workflow = readFileSync(new URL("../../.github/workflows/arquivar-workers-vps.yml", import.meta.url), "utf8");
  assert.ok(workflow.includes("default: " + APP_ESPERADO));
  for (const [revisao, esperado] of Object.entries(novos)) {
    assert.deepEqual(ALVOS[revisao], esperado);
    assert.ok(workflow.includes("- " + revisao));
    const imagemAlvo = { tag: "barberos-video-worker:" + revisao, ...esperado };
    const registro = { ...preparado(), alvo: revisao, imagens: [imagemAlvo] };
    validarPreparacao(registro, revisao);
    validarRestauracao(imagemAlvo, { Id: esperado.id, RepoTags: [imagemAlvo.tag], Size: esperado.bytesImagem }, revisao);
    assert.throws(() => validarPreparacao({ ...registro, imagemApp: "sha256:a2a78e0a4ab504fa65cb72c9c21130e05a261c2b4134bc3b41532fc407a187d6" }, revisao));
    assert.throws(() => validarRestauracao(imagemAlvo, { Id: esperado.id, RepoTags: [imagemAlvo.tag], Size: esperado.bytesImagem + 2011 }, revisao));
  }
});

test("comprovantes inicial e final são envelopes cifrados exclusivos do destinatário", () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 3072 });
  const publica = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  for (const concluido of [false, true]) {
    const r = { concluido, alvo, arquivo: "sentinela-de-conteudo-privado" };
    const dados = comprovanteCifrado(r, publica);
    assert.ok(!dados.includes("sentinela-de-conteudo-privado"));
    assert.ok(!dados.includes(alvo));
    assert.deepEqual(JSON.parse(decifrar(JSON.parse(dados), privateKey)), r);
  }
});

test("chave inválida bloqueia antes de arquivo, chave SSH temporária ou ação remota", () => {
  const pasta = mkdtempSync(join(tmpdir(), "worker-receipt-test-"));
  try {
    const destino = join(pasta, "resultado.cifrado.json");
    const r = spawnSync(process.execPath, [fileURLToPath(new URL("./arquivar-workers-vps.mjs", import.meta.url)), destino], {
      env: { ...process.env, GITHUB_ACTIONS: "true", RUNNER_OS: "Linux", DOCKER_HOST: "", DOCKER_CONTEXT: "",
        ARQUIVAMENTO_ALVO: alvo, VPS_HOST: "exemplo.invalid", VPS_USER: "root", VPS_PORT: "22", VPS_DIR: "/opt/barberos",
        VPS_PROJECT: "barberos", VPS_SSH_KEY: "nao-e-chave-de-verdade", VPS_KNOWN_HOSTS: "sentinela-sem-host",
        VPS_IMAGEM_ANTERIOR: APP_ESPERADO, RELATORIO_CHAVE_PUBLICA: "chave-publica-invalida", PATH: "", Path: "" },
      encoding: "utf8", timeout: 10000,
    });
    assert.equal(r.status, 1);
    assert.equal(existsSync(destino), false);
    assert.match(r.stderr, /^Arquivamento não comprovado\./);
    assert.ok(!r.stderr.includes("nao-e-chave-de-verdade"));
    assert.ok(!r.stdout.includes("sentinela"));
  } finally { rmSync(pasta, { recursive: true, force: true }); }
});

test("só aceita um alvo e a identidade completa do inventário", () => {
  for (const chave of Object.keys(ALVOS)) assert.equal(selecionarAlvo(chave).id, ALVOS[chave].id);
  for (const invalido of [undefined, "8a5566d", alvo + "," + Object.keys(ALVOS)[1], "__proto__"]) {
    assert.throws(() => selecionarAlvo(invalido));
  }
  validarPreparacao(preparado(), alvo);
  for (const alteracao of [{ alvo: "outro" }, { imagemApp: "sha256:" + "f".repeat(64) },
    { bytes: 2_000_000_001 }, { imagens: [imagem, imagem] }, { imagens: [{ ...imagem, id: "sha256:" + "a".repeat(64) }] }]) {
    assert.throws(() => validarPreparacao({ ...preparado(), ...alteracao }, alvo));
  }
});

test("load não basta: imagem restaurada deve preservar ID, tag única e tamanho", () => {
  const restaurada = { Id: imagem.id, RepoTags: [imagem.tag], Size: imagem.bytesImagem };
  validarRestauracao(imagem, restaurada, alvo);
  for (const alteracao of [{ Id: "sha256:" + "0".repeat(64) }, { RepoTags: [imagem.tag, "outra:tag"] }, { Size: 1 }]) {
    assert.throws(() => validarRestauracao(imagem, { ...restaurada, ...alteracao }, alvo));
  }
});

test("render sintético isolado não recebe rede, volumes, credenciais ou entrypoint do bot", () => {
  const args = argumentosSmoke(imagem.tag);
  assert.equal(args[args.indexOf("--network") + 1], "none");
  assert.equal(args[args.indexOf("--entrypoint") + 1], "node");
  assert.ok(args.includes("--read-only"));
  assert.equal(args[args.indexOf("--cap-drop") + 1], "ALL");
  const opcoesDocker = args.slice(0, args.indexOf(imagem.tag));
  for (const proibido of ["--env-file", "--env", "-e", "--mount", "-v", "--privileged"]) assert.ok(!opcoesDocker.includes(proibido));
  validarSmoke(JSON.stringify(smoke));
  for (const alteracao of [{ concluido: false }, { audio: false }, { largura: 1080 }, { duracao: 2 }]) {
    assert.throws(() => validarSmoke(JSON.stringify({ ...smoke, ...alteracao })));
  }
});

test("arquivo adulterado ou incompleto impede qualquer comando Docker", async () => {
  const pasta = mkdtempSync(join(tmpdir(), "worker-archive-test-"));
  try {
    const arquivo = join(pasta, "worker.tar.gz");
    for (const dados of [Buffer.from("menor"), Buffer.alloc(conteudo.length)]) {
      writeFileSync(arquivo, dados);
      await assert.rejects(validarCopia(preparado(), arquivo, alvo, () => assert.fail("Não deve executar Docker")));
    }
  } finally { rmSync(pasta, { recursive: true, force: true }); }
});

test("cópia íntegra delega a prova ao verificador OCI e exige conclusão completa", async () => {
  const pasta = mkdtempSync(join(tmpdir(), "worker-archive-test-"));
  try {
    const arquivo = join(pasta, "worker.tar.gz"), antes = preparado();
    writeFileSync(arquivo, conteudo);
    const executar = () => assert.fail("Verificador deve controlar Docker");
    const validar = async (a, e, x) => {
      assert.equal(a, arquivo); assert.equal(e, antes); assert.equal(x, executar);
      return { ...antes, restauracaoIsoladaValidada: true, renderSinteticoValidado: true };
    };
    await validarCopia(antes, arquivo, alvo, executar, validar);
    for (const alteracao of [{ restauracaoIsoladaValidada: false }, { renderSinteticoValidado: false }, { sha256: "outro" }, { imagens: [] }]) {
      await assert.rejects(validarCopia(antes, arquivo, alvo, executar, async (...args) => ({ ...await validar(...args), ...alteracao })));
    }
  } finally { rmSync(pasta, { recursive: true, force: true }); }
});

test("nenhuma falha de transporte, load, identidade ou render pode concluir remoção remota", async () => {
  for (const falha of ["transferir", "validar"]) {
    const chamadas = [];
    const etapa = nome => async () => { chamadas.push(nome); if (nome === falha) throw Error("Falha sintética"); return nome === "preparar" ? preparado() : "arquivo"; };
    await assert.rejects(executarFluxo({ preparar: etapa("preparar"), transferir: etapa("transferir"),
      validar: etapa("validar"), concluir: etapa("concluir") }, alvo));
    assert.ok(!chamadas.includes("concluir"));
  }
  const chamadas = [], antes = preparado();
  const resultado = await executarFluxo({ preparar: async () => { chamadas.push("preparar"); return antes; },
    transferir: async () => { chamadas.push("transferir"); return "arquivo"; },
    validar: async () => { chamadas.push("validar"); },
    concluir: async () => { chamadas.push("concluir"); return { concluido: true, sha256: antes.sha256, imagensArquivadas: antes.imagens }; } }, alvo);
  assert.deepEqual(chamadas, ["preparar", "transferir", "validar", "concluir"]);
  assert.equal(resultado.restauracaoIsoladaValidada, true);
  assert.equal(resultado.renderSinteticoValidado, true);
});
