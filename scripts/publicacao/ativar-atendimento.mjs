/** Transporte do ASR e ativação restrita; credenciais nunca saem do executor. */
import { execFileSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parametros } from "./consultar-vps.mjs";
import { cifrar } from "./cifrar-relatorio.mjs";
const shell = v => "'" + v.replace(/'/g, "'\\''") + "'";
const privado = mkdtempSync(join(tmpdir(), "barberos-atendimento-"));
let resultado = { concluido: false, etapa: "configuracao" };
try {
  const p = parametros(process.env), commit = process.env.GITHUB_SHA;
  if (!/^[a-f0-9]{40}$/.test(commit)) throw Error("Commit inválido");
  cifrar(Buffer.from("validacao"), process.env.RELATORIO_CHAVE_PUBLICA);
  const chave = join(privado, "identity"), hosts = join(privado, "known_hosts");
  writeFileSync(chave, process.env.VPS_SSH_KEY.trimEnd() + "\n", { mode: 0o600 });
  writeFileSync(hosts, process.env.VPS_KNOWN_HOSTS.trimEnd() + "\n", { mode: 0o600 });
  const args = ["-F", "none", "-T", "-p", p.porta, "-i", chave, "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
    "-o", "IdentityAgent=none", "-o", "StrictHostKeyChecking=yes", "-o", "HostKeyAlgorithms=ssh-ed25519",
    "-o", "GlobalKnownHostsFile=/dev/null", "-o", `UserKnownHostsFile=${hosts}`, "-o", "ConnectTimeout=15",
    "-o", "ServerAliveInterval=15", `${p.usuario}@${p.host}`];
  const remoto = (comando, opcoes = {}) => execFileSync("ssh", [...args, comando], { timeout: 600_000, maxBuffer: 1024 * 1024, stdio: ["pipe", "pipe", "pipe"], ...opcoes });
  const arquivo = process.argv[2];
  resultado.etapa = "capacidade";
  const codigo = "import shutil,sys; assert shutil.disk_usage(sys.argv[1]).free > int(sys.argv[2])*4+2*1024**3";
  remoto("python3 -c " + shell(codigo) + " " + shell(p.base) + " " + statSync(arquivo).size);
  resultado.etapa = "carregar_asr";
  const fd = openSync(arquivo, "r");
  try { remoto("bash -o pipefail -c 'gzip -dc | docker load'", { stdio: [fd, "pipe", "pipe"] }); }
  finally { closeSync(fd); }
  resultado.etapa = "ativacao_restrita";
  // O procedimento operacional atual usa os helpers da release comprovada, sem reescrevê-la.
  const codigo = "import sys\nsys.path.insert(0," + JSON.stringify(`${p.base}/releases/${commit}/barberos/scripts/publicacao`) + ")\n" +
    readFileSync(new URL("./ativar_atendimento.py", import.meta.url), "utf8");
  const comando = ["python3", "-c", codigo, p.base, p.projeto, commit, "--prova-sdk-stdin"];
  resultado = JSON.parse(remoto(comando.map(shell).join(" "), { input: readFileSync(process.argv[4]) }).toString());
  if (!resultado.concluido) throw Error("Ativação não comprovada");
  process.stdout.write("Atendimento ativado somente para dono/gerente; campanhas bloqueadas.\n");
} catch (erro) {
  try {
    const remoto = JSON.parse(erro.stdout?.toString() || "null");
    if (remoto?.concluido === false && typeof remoto.erro === "string") resultado.erro = remoto.erro;
  } catch { /* Nunca imprime stderr remoto ou credenciais. */ }
  process.stderr.write(`Atendimento não ativado na etapa ${resultado.etapa}; detalhes privados omitidos.\n`);
  process.exitCode = 1;
} finally {
  try { writeFileSync(process.argv[3], JSON.stringify(cifrar(Buffer.from(JSON.stringify(resultado)), process.env.RELATORIO_CHAVE_PUBLICA)), { mode: 0o600, flag: "wx" }); }
  catch { process.exitCode = 1; }
  rmSync(privado, { recursive: true, force: true });
}
