import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { gerarDiagnostico } from "./diagnostico-windows.mjs";
import { validarChavePublicaServidor, validarImpressaoServidor } from "./identidade-windows.mjs";

test("CMD incorpora o inventário, mantém a identidade do host e nunca pede senha", (t) => {
  const pasta = mkdtempSync(join(tmpdir(), "barberos-windows-teste-"));
  t.after(() => rmSync(pasta, { recursive: true, force: true }));
  const destino = join(pasta, "consultar.cmd");
  const { linhasCabecalho } = gerarDiagnostico(destino);
  const texto = readFileSync(destino, "utf8");
  const corpo = texto.split("\r\n").slice(linhasCabecalho).join("\n");
  const cabecalho = texto.split("\r\n").slice(0, linhasCabecalho).join("\n");
  assert.ok(cabecalho.includes(`more.com" +${linhasCabecalho}`));
  assert.ok(cabecalho.endsWith("exit /b 1"));
  assert.ok(cabecalho.includes("StrictHostKeyChecking=yes"));
  assert.ok(cabecalho.includes("BatchMode=yes"));
  assert.ok(!cabecalho.includes("powershell"));
  assert.match(corpo, /^"""Invent/);
  assert.ok(corpo.includes('"somenteLeitura": True'));
  assert.throws(() => gerarDiagnostico(destino), /EEXIST/);
});

function identidadePublicaSintetica() {
  // Somente dados públicos de teste, sem geração de chave privada ou identidade de acesso.
  const blob = Buffer.concat([Buffer.from([0, 0, 0, 11]), Buffer.from("ssh-ed25519"), Buffer.from([0, 0, 0, 32]), Buffer.from(Array.from({ length: 32 }, (_, i) => i))]);
  return { chave: "ssh-ed25519 " + blob.toString("base64"), pin: "SHA256:" + createHash("sha256").update(blob).digest("base64").replace(/=+$/, "") };
}

test("chave pública precisa corresponder à impressão confiável, e seu comentário nunca vira comando", (t) => {
  const { chave, pin } = identidadePublicaSintetica();
  const pasta = mkdtempSync(join(tmpdir(), "barberos-publica-teste-"));
  t.after(() => rmSync(pasta, { recursive: true, force: true }));
  const destino = join(pasta, "conferir.cmd");
  assert.throws(() => gerarDiagnostico(destino, "SHA256:" + "A".repeat(43), chave), /não corresponde/);
  assert.throws(() => readFileSync(destino), /ENOENT/);
  assert.throws(() => gerarDiagnostico(destino, undefined, chave), /impressão SHA256/);
  const { linhasCabecalho } = gerarDiagnostico(destino, pin, chave + ' root@exemplo & echo SENTINELA_NAO_EXECUTAR\r\n');
  const texto = readFileSync(destino, "utf8");
  assert.ok(texto.includes("179.236.244.156 " + chave));
  assert.ok(!texto.includes("SENTINELA_NAO_EXECUTAR"));
  assert.ok(!texto.includes("ssh-keyscan"));
  assert.ok(texto.includes("StrictHostKeyChecking=yes"));
  assert.ok(texto.includes("UserKnownHostsFile=known_hosts"));
  assert.ok(linhasCabecalho > 0);
});

test("recusa tipo, tamanho, múltiplas linhas e material privado sem exibir conteúdo", () => {
  const { chave, pin } = identidadePublicaSintetica();
  for (const entrada of [null, "ssh-rsa " + "A".repeat(68), "ssh-ed25519 " + "A".repeat(68), chave + "\n" + chave, ["-----BEGIN", "OPENSSH PRIVATE KEY-----", "SENTINELA_PRIVADA"].join(" ")]) {
    assert.throws(() => validarChavePublicaServidor(entrada, pin), (e) => !e.message.includes("SENTINELA_PRIVADA"));
  }
});

test("recusa entrada de comando ou impressão incompleta antes de gerar o arquivo", (t) => {
  const pasta = mkdtempSync(join(tmpdir(), "barberos-host-teste-"));
  t.after(() => rmSync(pasta, { recursive: true, force: true }));
  const destino = join(pasta, "invalido.cmd");
  for (const valor of ["", null, "SHA256:curto", "SHA256:" + "A".repeat(43) + "\n", "SHA256:" + "A".repeat(43) + "&calc.exe", "SHA256:" + "A".repeat(43) + '"']) {
    assert.throws(() => gerarDiagnostico(destino, valor), /impressão SHA256/);
    assert.throws(() => readFileSync(destino), /ENOENT/);
  }
  assert.equal(validarImpressaoServidor("SHA256:" + "A".repeat(43)), "SHA256:" + "A".repeat(43));
});

test("variante com identidade exige comparação prévia e preserva os arquivos SSH existentes", (t) => {
  const pasta = mkdtempSync(join(tmpdir(), "barberos-host-teste-"));
  t.after(() => rmSync(pasta, { recursive: true, force: true }));
  const destino = join(pasta, "conferir.cmd");
  const pin = "SHA256:" + "A".repeat(43); // Identidade sintética; não entregue para uso real.
  const { linhasCabecalho } = gerarDiagnostico(destino, pin);
  const texto = readFileSync(destino, "utf8");
  const linhas = texto.split("\r\n");
  const cabecalho = linhas.slice(0, linhasCabecalho).join("\n");
  assert.ok(cabecalho.includes(`if not "%%H"=="${pin}" goto :host_divergente`));
  assert.ok(cabecalho.indexOf("if not defined BB_HOST_VALIDADO") < cabecalho.indexOf('"%BB_SSH%" -T'));
  assert.ok(cabecalho.includes("StrictHostKeyChecking=yes"));
  assert.ok(cabecalho.includes("HostKeyAlgorithms=ssh-ed25519"));
  assert.ok(cabecalho.includes("UserKnownHostsFile=known_hosts"));
  assert.ok(cabecalho.includes('pushd "%BB_OUT%"'));
  assert.ok(!cabecalho.includes("StrictHostKeyChecking=no") && !cabecalho.includes("accept-new") && !cabecalho.includes("\\.ssh\\"));
});
