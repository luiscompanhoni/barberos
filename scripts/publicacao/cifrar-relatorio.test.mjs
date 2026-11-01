import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { cifrar, decifrar } from "./cifrar-relatorio.mjs";

test("somente o destinatário recupera o relatório; alterações no conteúdo são recusadas", () => {
  const par = generateKeyPairSync("rsa", { modulusLength: 3072 });
  const publica = par.publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const original = Buffer.from('{"caminho":"sentinela-operacional"}');
  const envelope = cifrar(original, publica);
  assert.ok(!JSON.stringify(envelope).includes("sentinela-operacional"));
  assert.deepEqual(decifrar(envelope, par.privateKey), original);
  const alterados = Buffer.from(envelope.dados, "base64"); alterados[0] ^= 1;
  assert.throws(() => decifrar({ ...envelope, dados: alterados.toString("base64") }, par.privateKey));
  const outro = generateKeyPairSync("rsa", { modulusLength: 3072 });
  assert.throws(() => decifrar(envelope, outro.privateKey));
});
