/** Consulta de disponibilidade: GET ao modelo existente, sem mensagens nem dados de clientes. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parametros } from "./consultar-vps.mjs";
import { cifrar } from "./cifrar-relatorio.mjs";
const shell = v => "'" + v.replace(/'/g, "'\\''") + "'";
const programa = readFileSync(process.argv[3]);
const privado = mkdtempSync(join(tmpdir(), "barberos-ia-diagnostico-"));
try {
  cifrar(Buffer.from("validacao"), process.env.RELATORIO_CHAVE_PUBLICA);
  const p = parametros(process.env), chave = join(privado, "identity"), hosts = join(privado, "known_hosts");
  writeFileSync(chave, process.env.VPS_SSH_KEY.trimEnd() + "\n", { mode: 0o600 });
  writeFileSync(hosts, process.env.VPS_KNOWN_HOSTS.trimEnd() + "\n", { mode: 0o600 });
  const remoto = String.raw`import json,subprocess,sys
ids=subprocess.check_output(['docker','ps','-q','--filter','label=com.docker.compose.project='+sys.argv[1],'--filter','label=com.docker.compose.service=app']).decode().split()
assert len(ids)==1
r=subprocess.check_output(['docker','exec','-i',ids[0],'node'],input=sys.stdin.buffer.read(),stderr=subprocess.PIPE,timeout=40)
print(json.dumps(json.loads(r)))`;
  const args = ["-F", "none", "-T", "-p", p.porta, "-i", chave, "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
    "-o", "IdentityAgent=none", "-o", "StrictHostKeyChecking=yes", "-o", "HostKeyAlgorithms=ssh-ed25519",
    "-o", "GlobalKnownHostsFile=/dev/null", "-o", `UserKnownHostsFile=${hosts}`, "-o", "ConnectTimeout=15",
    `${p.usuario}@${p.host}`, "python3 -c " + shell(remoto) + " " + shell(p.projeto)];
  const r = JSON.parse(execFileSync("ssh", args, { input: programa, timeout: 55000, maxBuffer: 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] }).toString());
  writeFileSync(process.argv[2], JSON.stringify(cifrar(Buffer.from(JSON.stringify(r)), process.env.RELATORIO_CHAVE_PUBLICA)), { mode: 0o600, flag: "wx" });
  process.stdout.write("Consulta concluída; metadados protegidos no relatório cifrado.\n");
} catch {
  process.stderr.write("Consulta não concluída; nenhuma credencial exibida.\n");
  process.exitCode = 1;
} finally { rmSync(privado, { recursive: true, force: true }); }
