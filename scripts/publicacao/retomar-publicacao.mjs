/** Executa somente a retomada nominada; o relatório de produção sai cifrado. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parametros } from "./consultar-vps.mjs";
import { cifrar } from "./cifrar-relatorio.mjs";
const shell = v => "'" + v.replace(/'/g, "'\\''") + "'";
const privado = mkdtempSync(join(tmpdir(), "barberos-retomar-"));
let resultado = { resultado: { concluido: false } };
try {
  cifrar(Buffer.from("validacao"), process.env.RELATORIO_CHAVE_PUBLICA);
  const p = parametros(process.env), chave = join(privado, "identity"), hosts = join(privado, "known_hosts");
  writeFileSync(chave, process.env.VPS_SSH_KEY.trimEnd() + "\n", { mode: 0o600 });
  writeFileSync(hosts, process.env.VPS_KNOWN_HOSTS.trimEnd() + "\n", { mode: 0o600 });
  const args = ["-F", "none", "-T", "-p", p.porta, "-i", chave, "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
    "-o", "IdentityAgent=none", "-o", "StrictHostKeyChecking=yes", "-o", "HostKeyAlgorithms=ssh-ed25519",
    "-o", "GlobalKnownHostsFile=/dev/null", "-o", `UserKnownHostsFile=${hosts}`, "-o", "ConnectTimeout=15",
    "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=4", `${p.usuario}@${p.host}`];
  const codigo = readFileSync(new URL("./retomar_publicacao.py", import.meta.url), "utf8");
  const comando = "python3 -c " + shell(codigo) + " " + [p.base, p.projeto].map(shell).join(" ");
  try {
    resultado = JSON.parse(execFileSync("ssh", [...args, comando], { timeout: 1200_000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).toString());
  } catch (erro) {
    try { resultado = JSON.parse(erro.stdout?.toString()); } catch { /* Sem stderr ou segredos. */ }
  }
  if (resultado.resultado?.concluido !== true) throw Error("Retomada não comprovada");
  process.stdout.write("Publicação retomada e comprovada pelo publicador original.\n");
} catch {
  process.stderr.write("Retomada não concluída; consultar comprovante cifrado.\n");
  process.exitCode = 1;
} finally {
  try { writeFileSync(process.argv[2], JSON.stringify(cifrar(Buffer.from(JSON.stringify(resultado)), process.env.RELATORIO_CHAVE_PUBLICA)), { mode: 0o600, flag: "wx" }); }
  catch { process.exitCode = 1; }
  rmSync(privado, { recursive: true, force: true });
}
