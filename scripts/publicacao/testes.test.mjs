import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { preparar } from "./preparar.mjs";
import { consultar, parametros } from "./consultar-vps.mjs";

function fixture(t) {
  const pasta = mkdtempSync(join(tmpdir(), "barberos-pacote-teste-"));
  t.after(() => rmSync(pasta, { recursive: true, force: true }));
  const repo = join(pasta, "repo"); mkdirSync(repo);
  const hooks = join(pasta, "hooks-vazios"); mkdirSync(hooks);
  const git = (...args) => execFileSync("git", ["-c", `core.hooksPath=${hooks}`, "-C", repo, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q"); git("config", "user.name", "Teste descartável"); git("config", "user.email", "teste@example.invalid");
  const escrever = (nome, conteudo) => { mkdirSync(dirname(join(repo, nome)), { recursive: true }); writeFileSync(join(repo, nome), conteudo); };
  escrever("package.json", JSON.stringify({ dependencies: { next: "16.4.1" } }));
  escrever(".gitignore", ".env\n");
  escrever("prisma/migrations/20261029120000_lgpd_cliente/migration.sql", "SELECT 1;\n");
  const salvarFixture = () => { git("add", "."); git("-c", "commit.gpgsign=false", "commit", "-qm", "fixture descartável"); };
  salvarFixture();
  return { pasta, repo, git, escrever, salvarFixture };
}

test("empacota o commit exato, inclui migração e exclui .env ignorado", (t) => {
  const f = fixture(t); f.escrever(".env", "DADO_PRIVADO=sentinela-nao-exportar\n");
  const resultado = preparar(f.repo, join(f.pasta, "saida"));
  const manifesto = JSON.parse(readFileSync(join(resultado.destino, "versao.json"), "utf8"));
  assert.equal(manifesto.commit, f.git("rev-parse", "HEAD").toString().trim());
  assert.equal(manifesto.migracoes.length, 1);
  assert.ok(!manifesto.arquivos.some((a) => a.caminho === ".env"));
  const lista = execFileSync("tar", ["-tzf", join(resultado.destino, "codigo.tar.gz")]).toString();
  assert.ok(lista.includes("prisma/migrations/20261029120000_lgpd_cliente/migration.sql"));
  assert.ok(!lista.split("\n").includes("barberos/.env"));
  assert.equal(f.git("status", "--porcelain").toString(), "");
  assert.throws(() => preparar(f.repo, resultado.destino), /já existe/);
});

test("recusa alterações locais e arquivos novos sem apagá-los", (t) => {
  const f = fixture(t); f.escrever("trabalho-novo.txt", "preservar");
  assert.throws(() => preparar(f.repo, join(f.pasta, "saida")), /sem commit/);
  assert.equal(readFileSync(join(f.repo, "trabalho-novo.txt"), "utf8"), "preservar");
  assert.ok(!readdirSync(f.pasta).includes("saida"));
});

test("inclui código da funcionalidade de backups sem confundi-lo com dados privados", (t) => {
  const f = fixture(t);
  f.escrever("src/app/api/backups/route.ts", "export const GET = () => new Response('ok');\n");
  f.escrever("src/lib/backups/servico.ts", "export const listar = () => [];\n");
  f.salvarFixture();
  const resultado = preparar(f.repo, join(f.pasta, "saida"));
  const lista = execFileSync("tar", ["-tzf", join(resultado.destino, "codigo.tar.gz")]).toString();
  assert.ok(lista.includes("barberos/src/app/api/backups/route.ts"));
  assert.ok(lista.includes("barberos/src/lib/backups/servico.ts"));
});

test("continua recusando arquivos da pasta privada de backups", (t) => {
  const f = fixture(t);
  f.escrever("backups/registro.json", "{\"privado\":true}\n"); f.salvarFixture();
  assert.throws(() => preparar(f.repo, join(f.pasta, "saida")), /Arquivo privado ou gerado/);
  assert.ok(!readdirSync(f.pasta).includes("saida"));
});

test("recusa destino dentro da cópia de trabalho", (t) => {
  const f = fixture(t);
  assert.throws(() => preparar(f.repo, join(f.repo, "pacote")), /fora da cópia/);
});

test("recusa credencial versionada sem revelar seu conteúdo", (t) => {
  const f = fixture(t);
  const cabecalho = ["-----BEGIN", "OPENSSH PRIVATE KEY-----"].join(" ");
  f.escrever("configuracao.txt", cabecalho + "\nsentinela\n"); f.salvarFixture();
  assert.throws(() => preparar(f.repo, join(f.pasta, "saida")), (e) => /credencial/.test(e.message) && !e.message.includes("sentinela"));
});

test("valida argumentos SSH e exige host previamente conhecido", () => {
  const env = { VPS_HOST: "host.example.invalid", VPS_USER: "root", VPS_SSH_KEY: "sentinela", VPS_KNOWN_HOSTS: "host-conhecido" };
  assert.equal(parametros(env).porta, "22");
  assert.throws(() => parametros({ ...env, VPS_HOST: "-oProxyCommand=bad" }), /inválidos/);
  assert.throws(() => parametros({ ...env, VPS_DIR: "/opt/barberos;id" }), /inválidos/);
  assert.throws(() => parametros({ ...env, VPS_DIR: "/opt/../etc" }), /inválidos/);
  assert.throws(() => parametros({ ...env, VPS_KNOWN_HOSTS: "" }), /VPS_KNOWN_HOSTS/);
});

test("consulta exige verificação de host, usa arquivos privados e limpa a credencial temporária", (t) => {
  const pasta = mkdtempSync(join(tmpdir(), "barberos-ssh-teste-"));
  t.after(() => rmSync(pasta, { recursive: true, force: true }));
  const env = { VPS_HOST: "host.example.invalid", VPS_USER: "root", VPS_SSH_KEY: "sentinela-nao-exibir", VPS_KNOWN_HOSTS: "host-conhecido" };
  for (const falhar of [false, true]) {
    let temporario;
    const executar = (comando, args, options) => {
      assert.equal(comando, "ssh");
      for (const opcao of ["StrictHostKeyChecking=yes", "BatchMode=yes", "IdentitiesOnly=yes"]) assert.ok(args.includes(opcao));
      assert.equal(args[args.indexOf("-F") + 1], "none");
      temporario = args[args.indexOf("-i") + 1];
      assert.equal(readFileSync(temporario, "utf8"), env.VPS_SSH_KEY + "\n");
      if (process.platform !== "win32") assert.equal(statSync(temporario).mode & 0o777, 0o600);
      assert.ok(Buffer.isBuffer(options.input));
      if (falhar) throw Object.assign(new Error("sentinela"), { stderr: "Permission denied: sentinela" });
      return Buffer.from(JSON.stringify({ formato: 1, somenteLeitura: true, servicos: [], migracoes: [], bloqueios: [] }));
    };
    const destino = join(pasta, falhar ? "falha.json" : "relatorio.json");
    if (falhar) {
      assert.throws(() => consultar(env, destino, executar), e => /Autenticação recusada/.test(e.message) && !e.message.includes("sentinela"));
      assert.throws(() => readFileSync(destino), /ENOENT/);
    } else assert.equal(consultar(env, destino, executar).arquivoCriado, true);
    assert.throws(() => readFileSync(temporario), /ENOENT/);
  }
});
