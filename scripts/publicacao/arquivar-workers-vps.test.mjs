import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

test("cópia íntegra exige load, inspect e render antes de aceitar", async () => {
  const pasta = mkdtempSync(join(tmpdir(), "worker-archive-test-"));
  try {
    const arquivo = join(pasta, "worker.tar.gz"), chamadas = [];
    writeFileSync(arquivo, conteudo);
    await validarCopia(preparado(), arquivo, alvo, (bin, args) => {
      assert.equal(bin, "docker"); chamadas.push(args);
      if (args[0] === "load") return Buffer.from("carregado");
      if (args[0] === "image") return Buffer.from(JSON.stringify([{ Id: imagem.id, RepoTags: [imagem.tag], Size: imagem.bytesImagem }]));
      return Buffer.from(JSON.stringify(smoke));
    });
    assert.deepEqual(chamadas.map(args => args[0]), ["load", "image", "run"]);
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
