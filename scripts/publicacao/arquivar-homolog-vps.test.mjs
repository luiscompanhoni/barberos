import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ALVO, APP_ESPERADO, BRANCH, BYTES_IMAGEM, CANONICO_SHA256, ID, ROOTFS, TAG,
  argumentosSmoke, executarFluxo, validarCi, validarCopia, validarPreparacao, validarSmoke } from "./arquivar-homolog-vps.mjs";

const preparado = () => ({ formato: 2, alvo: ALVO, imagemApp: APP_ESPERADO, arquivo: "workers-123.tar.gz", bytes: 100,
  sha256: "a".repeat(64), imagens: [{ tag: TAG, id: ID, bytesImagem: BYTES_IMAGEM }] });
const smoke = { concluido: true, sintaxeServidorValidada: true, pacotesValidados: ["next", "react"], uid: 1000, gid: 1000 };
const prova = { restauracaoIsoladaValidada: true, aplicacaoSinteticaValidada: true };
const restaurada = () => ({ Id: ID, Os: "linux", Architecture: "amd64", RootFS: { Layers: [...ROOTFS] }, RepoTags: [TAG], Config: { Env: [] } });

test("fonte reutilizada continua fixada à 582 e não amplia os workers", () => {
  assert.equal(createHash("sha256").update(readFileSync(new URL("./arquivar_workers.py", import.meta.url))).digest("hex"), CANONICO_SHA256);
  assert.equal(ALVO, "homolog-20261021"); assert.equal(ROOTFS.length, 13);
  const fluxo = readFileSync(new URL("../../.github/workflows/arquivar-workers-vps.yml", import.meta.url), "utf8");
  assert.match(fluxo, /if: github.ref == 'refs\/heads\/main' && inputs.alvo != 'homolog-20261021'/);
  assert.match(fluxo, /if: github.ref == 'refs\/heads\/main' && inputs.alvo == 'homolog-20261021'/);
  assert.match(fluxo, /group: publicacao-producao/); assert.match(fluxo, /--event push/);
  assert.ok(fluxo.indexOf("Exigir CI push aprovado") < fluxo.indexOf("Conferir guards nominais"));
  assert.ok(fluxo.indexOf("Conferir guards nominais") < fluxo.indexOf("name: Arquivar app legado"));
  assert.match(fluxo, /name: homolog-arquivamento-comprovante-cifrado/);
  assert.match(fluxo, /retention-days: 1/);
});

test("CI exige SHA, evento push, main e conclusão exatos", () => {
  const env = { GITHUB_REF: "refs/heads/" + BRANCH, GITHUB_SHA: "a".repeat(40) };
  const r = { headSha: env.GITHUB_SHA, headBranch: BRANCH, event: "push", status: "completed", conclusion: "success" };
  validarCi([r], env);
  for (const mudanca of [{ headSha: "b".repeat(40) }, { headBranch: "outra" }, { event: "pull_request" }, { status: "in_progress" }, { conclusion: "failure" }]) assert.throws(() => validarCi([{ ...r, ...mudanca }], env));
  assert.throws(() => validarCi([r], { ...env, GITHUB_REF: "refs/heads/manutencao-imagem-legada-20261109" }));
});

test("preparação aceita somente uma imagem nominal e arquivo limitado", () => {
  validarPreparacao(preparado());
  for (const mudanca of [{ alvo: "outro" }, { imagemApp: "sha256:" + "f".repeat(64) }, { arquivo: "../workers-1.tar.gz" },
    { bytes: 2_000_000_001 }, { imagens: [] }, { imagens: [...preparado().imagens, ...preparado().imagens] },
    { imagens: [{ tag: TAG, id: ID, bytesImagem: 1 }] }]) assert.throws(() => validarPreparacao({ ...preparado(), ...mudanca }));
});

test("smoke é não privilegiado, sem rede/volumes/env e sem executar servidor ou Prisma", () => {
  const args = argumentosSmoke(), flags = args.slice(0, args.indexOf(TAG));
  for (const [flag, valor] of [["--network", "none"], ["--user", "1000:1000"], ["--entrypoint", "node"], ["--cap-drop", "ALL"]]) assert.equal(args[args.indexOf(flag) + 1], valor);
  assert.ok(args.includes("--read-only"));
  assert.ok(args.includes("--pull=never")); assert.ok(args.includes("--no-healthcheck"));
  for (const flag of ["--env", "--env-file", "--mount", "-v", "--privileged"]) assert.ok(!flags.includes(flag));
  assert.match(args.at(-1), /\["--check", "\/app\/server.js"\]/);
  assert.ok(!args.at(-1).includes("migrate"));
  validarSmoke(JSON.stringify(smoke));
  for (const mudanca of [{ uid: 0 }, { gid: 0 }, { concluido: false }, { sintaxeServidorValidada: false }, { pacotesValidados: [] }]) assert.throws(() => validarSmoke(JSON.stringify({ ...smoke, ...mudanca })));
});

function ensaio({ falha, alteracao, ocupado, rootfs } = {}) {
  const chamadas = [];
  const executar = (_cmd, args) => {
    chamadas.push(args);
    if (args[0] === "load" && falha === "load") throw Error("Falha sintética");
    if (args[0] === "image" && args[1] === "inspect") return Buffer.from(JSON.stringify([{ ...restaurada(), ...alteracao }]));
    if (args[0] === "run") return Buffer.from(JSON.stringify(falha === "smoke" ? { ...smoke, uid: 0 } : smoke));
    if ((args[0] === "image" || args[0] === "ps") && ocupado) return Buffer.from("preexistente");
    return Buffer.from("");
  };
  const conferir = async () => { if (falha === "arquivo") throw Error("Arquivo adulterado"); };
  const extrair = () => ({ "manifest.json": { base64: Buffer.from("[]").toString("base64") } });
  const manifestar = () => [{ id: ID, configId: "sha256:" + "b".repeat(64), diffIds: rootfs || ROOTFS, formato: "OCI_INDEX_V1" }];
  return { chamadas, executar, conferir, extrair, manifestar };
}

test("restauração exige arquivo íntegro e RootFS antes de tocar Docker", async () => {
  for (const opcoes of [{ falha: "arquivo" }, { rootfs: [] }]) {
    const a = ensaio(opcoes);
    await assert.rejects(validarCopia(preparado(), "sintetico", a.executar, a.conferir, a.extrair, a.manifestar));
    assert.equal(a.chamadas.length, 0);
  }
});

test("Docker pré-existente impede load e nenhuma falha de identidade/smoke aprova restauração", async () => {
  for (const opcoes of [{ ocupado: true }, { falha: "load" }, { alteracao: { Id: "sha256:" + "c".repeat(64) } },
    { alteracao: { RepoTags: [TAG, "outra:tag"] } }, { alteracao: { RootFS: { Layers: [] } } },
    { alteracao: { Config: { Env: ["NODE_OPTIONS=--require=inesperado"] } } },
    { alteracao: { Config: { Env: ["NODE_OPTIONS=\n--require=inesperado"] } } }, { falha: "smoke" }]) {
    const a = ensaio(opcoes);
    await assert.rejects(validarCopia(preparado(), "sintetico", a.executar, a.conferir, a.extrair, a.manifestar));
    if (opcoes.ocupado) assert.ok(!a.chamadas.some(args => args[0] === "load"));
  }
  const a = ensaio(), r = await validarCopia(preparado(), "sintetico", a.executar, a.conferir, a.extrair, a.manifestar);
  assert.equal(r.aplicacaoSinteticaValidada, true); assert.equal(r.restauracaoIsoladaValidada, true);
  assert.ok(!Object.hasOwn(r, "renderSinteticoValidado"));
});

test("remoção só ocorre após transporte e prova completa; resultado precisa comprovar preservação", async () => {
  const antes = preparado();
  const final = { concluido: true, alvo: ALVO, sha256: antes.sha256, bytes: antes.bytes,
    imagensArquivadas: antes.imagens, containersVolumesBackupsConfiguracaoPreservados: true };
  for (const fase of ["transferir", "validar"]) {
    let removeu = false;
    await assert.rejects(executarFluxo({ preparar: async () => antes, transferir: async () => { if (fase === "transferir") throw Error(); return "a"; },
      validar: async () => { throw Error(); }, concluir: async () => { removeu = true; return final; } }));
    assert.equal(removeu, false);
  }
  for (const incompleta of [{}, { ...prova, aplicacaoSinteticaValidada: false }]) await assert.rejects(executarFluxo({ preparar: async () => antes,
    transferir: async () => "a", validar: async () => incompleta, concluir: async () => assert.fail("Não remover") }));
  const fluxo = extra => executarFluxo({ preparar: async () => antes, transferir: async () => "a", validar: async () => prova, concluir: async () => ({ ...final, ...extra }) });
  assert.equal((await fluxo({})).concluido, true);
  await assert.rejects(fluxo({ containersVolumesBackupsConfiguracaoPreservados: false }));
});

test("chave pública inválida interrompe antes de SSH ou arquivo de recibo", () => {
  const pasta = mkdtempSync(join(tmpdir(), "homolog-guard-")), destino = join(pasta, "recibo.json");
  try {
    const r = spawnSync(process.execPath, [fileURLToPath(new URL("./arquivar-homolog-vps.mjs", import.meta.url)), destino], { encoding: "utf8", timeout: 10000,
      env: { ...process.env, GITHUB_ACTIONS: "true", RUNNER_OS: "Linux", GITHUB_REF: "refs/heads/main", DOCKER_HOST: "", DOCKER_CONTEXT: "",
        ARQUIVAMENTO_ALVO: ALVO, VPS_HOST: "exemplo.invalid", VPS_USER: "root", VPS_SSH_KEY: "sentinela-privada", VPS_KNOWN_HOSTS: "host-ficticio",
        VPS_IMAGEM_ANTERIOR: APP_ESPERADO, RELATORIO_CHAVE_PUBLICA: "invalida", PATH: "", Path: "" } });
    assert.equal(r.status, 1); assert.equal(existsSync(destino), false);
    assert.ok(!r.stderr.includes("sentinela-privada"));
  } finally { rmSync(pasta, { recursive: true, force: true }); }
});
