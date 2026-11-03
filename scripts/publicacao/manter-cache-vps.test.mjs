import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { manter } from "./manter-cache-vps.mjs";

const env = { VPS_HOST: "exemplo.invalid", VPS_USER: "root", VPS_SSH_KEY: "chave-ficticia",
  VPS_KNOWN_HOSTS: "host-ficticio", VPS_IMAGEM_ANTERIOR: "sha256:" + "a".repeat(64) };
const prova = { imagensPreservadas: true, containersPreservados: true, volumesPreservados: true,
  backupsConfiguracaoPreservados: true, escopoCache: "unused-private-regular", livreDepois: 9_000_000_000 };

test("usa host fixado, chave isolada, script limitado e remove credenciais temporárias", () => {
  const pasta = mkdtempSync(join(tmpdir(), "teste-cache-"));
  let chave;
  try {
    const destino = join(pasta, "resultado.json");
    const r = manter(env, destino, (bin, args, opts) => {
      assert.equal(bin, "ssh");
      for (const flag of ["StrictHostKeyChecking=yes", "IdentitiesOnly=yes", "IdentityAgent=none", "BatchMode=yes"]) assert.ok(args.includes(flag));
      assert.equal(args.at(-1), `python3 - /opt/barberos barberos ${env.VPS_IMAGEM_ANTERIOR} --manutencao`);
      chave = args[args.indexOf("-i") + 1];
      assert.ok(existsSync(chave));
      assert.ok(opts.input.toString().includes("fcntl.LOCK_EX | fcntl.LOCK_NB"));
      return Buffer.from(JSON.stringify(prova));
    });
    assert.equal(r.livreDepois, prova.livreDepois);
    assert.deepEqual(JSON.parse(readFileSync(destino)), prova);
    assert.equal(existsSync(chave), false);
  } finally { rmSync(pasta, { recursive: true, force: true }); }
});

test("recusa imagem e parâmetros de shell antes de conectar", () => {
  for (const alteracao of [{ VPS_IMAGEM_ANTERIOR: "sha256:errado" }, { VPS_DIR: "/opt/barberos; id" }, { VPS_PROJECT: "barberos; id" }]) {
    assert.throws(() => manter({ ...env, ...alteracao }, "inexistente", () => assert.fail("não deve conectar")));
  }
});

test("falha fechada sem prova e não expõe erro SSH ou grava sucesso", () => {
  const pasta = mkdtempSync(join(tmpdir(), "teste-cache-"));
  try {
    for (const executar of [() => Buffer.from(JSON.stringify({ ...prova, imagensPreservadas: false })), () => { throw new Error("SEGREDO"); }]) {
      assert.throws(() => manter(env, join(pasta, "resultado.json"), executar), erro => !erro.message.includes("SEGREDO") && erro.message.includes("não comprovada"));
      assert.equal(existsSync(join(pasta, "resultado.json")), false);
    }
  } finally { rmSync(pasta, { recursive: true, force: true }); }
});
