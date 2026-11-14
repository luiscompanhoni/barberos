import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { limparImagens, resumo } from "./limpar-imagens-vps.mjs";

const env = { VPS_HOST: "exemplo.invalid", VPS_USER: "root", VPS_SSH_KEY: "chave-ficticia",
  VPS_KNOWN_HOSTS: "host-ficticio", VPS_IMAGEM_ANTERIOR: "sha256:" + "a".repeat(64) };
const base = { commitNoAr: "c".repeat(40), manterCommits: ["c".repeat(40)], livreAntes: 7e9, livreDepois: 7e9,
  manter: [{ repo: "barberos-app", tag: "c".repeat(40) }], remover: [{ repo: "barberos-app", tag: "d".repeat(40), bytes: 1e9 }],
  estimativaLiberadaBytes: 1e9, removido: false };
const removido = { ...base, removido: true, livreDepois: 9e9, containersPreservados: true, volumesPreservados: true,
  imagensMantidasPreservadas: true, backupsConfiguracaoPreservados: true };

function rodar(extra, resposta, verificar = () => {}) {
  const pasta = mkdtempSync(join(tmpdir(), "teste-imagens-"));
  try {
    const destino = join(pasta, "r.json");
    const r = limparImagens({ ...env, ...extra }, destino, (bin, args, opts) => { verificar(bin, args, opts); return Buffer.from(JSON.stringify(resposta)); });
    return { r, gravado: JSON.parse(readFileSync(destino)) };
  } finally { rmSync(pasta, { recursive: true, force: true }); }
}

test("por padrão só lista: não passa --remover", () => {
  const { r } = rodar({}, base, (bin, args, opts) => {
    assert.equal(bin, "ssh");
    for (const flag of ["StrictHostKeyChecking=yes", "IdentitiesOnly=yes", "BatchMode=yes"]) assert.ok(args.includes(flag));
    assert.equal(args.at(-1), `python3 - /opt/barberos barberos ${env.VPS_IMAGEM_ANTERIOR}`);
    assert.ok(opts.input.toString().includes("fcntl.LOCK_EX | fcntl.LOCK_NB"));
  });
  assert.equal(r.removido, false);
  assert.match(resumo(r), /Seriam removidas 1 tags/);
});

test("remove só com confirmação e exige prova de preservação", () => {
  const { gravado } = rodar({ REMOVER_IMAGENS: "true" }, removido, (_b, args) => assert.ok(args.at(-1).endsWith(" --remover")));
  assert.equal(gravado.livreDepois, 9e9);
  assert.throws(() => rodar({ REMOVER_IMAGENS: "true" }, { ...removido, volumesPreservados: false }), /não comprovada/);
  assert.throws(() => rodar({ REMOVER_IMAGENS: "true" }, base), /não comprovada/);
});

test("recusa parâmetros de shell antes de conectar e não expõe erro SSH", () => {
  for (const alteracao of [{ VPS_IMAGEM_ANTERIOR: "sha256:errado" }, { VPS_DIR: "/opt/barberos; id" }, { VPS_PROJECT: "barberos; id" }]) {
    assert.throws(() => limparImagens({ ...env, ...alteracao }, "inexistente", () => assert.fail("não deve conectar")));
  }
  const pasta = mkdtempSync(join(tmpdir(), "teste-imagens-"));
  try {
    assert.throws(() => limparImagens(env, join(pasta, "r.json"), () => { throw new Error("SEGREDO"); }), e => !e.message.includes("SEGREDO"));
    assert.equal(existsSync(join(pasta, "r.json")), false);
  } finally { rmSync(pasta, { recursive: true, force: true }); }
});
