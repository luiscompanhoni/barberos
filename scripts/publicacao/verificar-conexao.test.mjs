import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { verificar } from "./verificar-conexao.mjs";

const env = { VPS_HOST: "vps.example.invalid", VPS_USER: "root", VPS_SSH_KEY: "sentinela-privada\r\n", VPS_KNOWN_HOSTS: "sentinela-host" };

test("informa somente nomes ausentes e recusa argumentos de comando antes de conectar", () => {
  let chamadas = 0;
  const executar = () => { chamadas++; };
  assert.throws(() => verificar({ ...env, VPS_SSH_KEY: "" }, executar), /Cadastro ausente.*VPS_SSH_KEY/);
  for (const alteracao of [{ VPS_HOST: "-oProxyCommand=bad" }, { VPS_USER: "root;id" }, { VPS_PORT: "70000" }]) {
    assert.throws(() => verificar({ ...env, ...alteracao }, executar), /formato inválido/);
  }
  assert.equal(chamadas, 0);
});

test("autentica sem senha/agente, exige host ED25519 conhecido e remove arquivos privados", () => {
  let arquivos;
  const resultado = verificar(env, (comando, args, options) => {
    assert.equal(comando, "ssh");
    for (const opcao of ["BatchMode=yes", "IdentitiesOnly=yes", "IdentityAgent=none", "StrictHostKeyChecking=yes", "HostKeyAlgorithms=ssh-ed25519", "GlobalKnownHostsFile=/dev/null", "PasswordAuthentication=no", "KbdInteractiveAuthentication=no"]) {
      assert.ok(args.includes(opcao));
    }
    assert.equal(args[args.indexOf("-F") + 1], "none");
    assert.equal(args.at(-1), "printf 'BARBEROS_SSH_OK\\n'");
    const chave = args[args.indexOf("-i") + 1];
    const hosts = args.find((a) => a.startsWith("UserKnownHostsFile=")).slice("UserKnownHostsFile=".length);
    arquivos = [chave, hosts];
    assert.equal(readFileSync(chave, "utf8"), "sentinela-privada\n");
    assert.equal(readFileSync(hosts, "utf8"), env.VPS_KNOWN_HOSTS + "\n");
    if (process.platform !== "win32") for (const arquivo of arquivos) assert.equal(statSync(arquivo).mode & 0o777, 0o600);
    assert.equal(options.env.VPS_SSH_KEY, undefined);
    assert.equal(options.env.VPS_KNOWN_HOSTS, undefined);
    assert.deepEqual(options.stdio, ["ignore", "pipe", "pipe"]);
    return Buffer.from("BARBEROS_SSH_OK\n");
  });
  assert.match(resultado, /validada por chave/);
  for (const arquivo of arquivos) assert.equal(existsSync(arquivo), false);
});

test("limpa a credencial e omite stderr privado em todas as falhas SSH", () => {
  for (const [stderr, esperado] of [
    ["Host key verification failed", /Identidade/], ["Permission denied", /recusou a chave/],
    ["Load key: error in libcrypto", /não foi reconhecida/], ["Connection refused", /recusou a conexão/],
    ["Connection timed out", /tempo limite/], ["falha desconhecida", /detalhes privados omitidos/],
  ]) {
    let chave;
    assert.throws(() => verificar(env, (_, args) => {
      chave = args[args.indexOf("-i") + 1];
      throw Object.assign(new Error("sentinela"), { stderr: stderr + " sentinela-privada" });
    }), (erro) => esperado.test(erro.message) && !erro.message.includes("sentinela"));
    assert.equal(existsSync(chave), false);
  }
});

test("não confunde resposta inesperada com conexão validada nem publica seu conteúdo", () => {
  assert.throws(() => verificar(env, () => Buffer.from("sentinela-privada")),
    (erro) => /não confirmou/.test(erro.message) && !erro.message.includes("sentinela"));
});
