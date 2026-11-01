/** Relatórios operacionais em repositório público são exportados somente cifrados. */
import { constants, createCipheriv, createDecipheriv, createPublicKey, privateDecrypt, publicEncrypt, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function cifrar(conteudo, publicaBase64) {
  const publica = createPublicKey({ key: Buffer.from(publicaBase64, "base64"), type: "spki", format: "der" });
  if (publica.asymmetricKeyType !== "rsa" || publica.asymmetricKeyDetails.modulusLength < 3072) {
    throw new Error("Chave de relatório incompatível.");
  }
  const chave = randomBytes(32);
  const iv = randomBytes(12);
  const cifra = createCipheriv("aes-256-gcm", chave, iv);
  const dados = Buffer.concat([cifra.update(conteudo), cifra.final()]);
  const chaveCifrada = publicEncrypt({ key: publica, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, chave);
  chave.fill(0);
  return { formato: 1, algoritmo: "RSA-OAEP-SHA256+A256GCM", chave: chaveCifrada.toString("base64"), iv: iv.toString("base64"), tag: cifra.getAuthTag().toString("base64"), dados: dados.toString("base64") };
}

export function decifrar(envelope, privada) {
  if (envelope.formato !== 1 || envelope.algoritmo !== "RSA-OAEP-SHA256+A256GCM") throw new Error("Formato incompatível.");
  const chave = privateDecrypt({ key: privada, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(envelope.chave, "base64"));
  try {
    const cifra = createDecipheriv("aes-256-gcm", chave, Buffer.from(envelope.iv, "base64"));
    cifra.setAuthTag(Buffer.from(envelope.tag, "base64"));
    return Buffer.concat([cifra.update(Buffer.from(envelope.dados, "base64")), cifra.final()]);
  } finally { chave.fill(0); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const envelope = cifrar(readFileSync(process.argv[2]), process.env.RELATORIO_CHAVE_PUBLICA);
    writeFileSync(process.argv[3], JSON.stringify(envelope), { flag: "wx", mode: 0o600 });
    process.stdout.write("Relatório cifrado; conteúdo privado omitido.\n");
  } catch { process.stderr.write("Não foi possível cifrar o relatório.\n"); process.exitCode = 1; }
}
