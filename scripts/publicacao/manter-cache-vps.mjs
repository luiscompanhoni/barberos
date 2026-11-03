/** Manutenção manual de cache privado; não altera a aplicação ou seus dados. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parametros } from "./consultar-vps.mjs";

export function manter(env, destino, executar = execFileSync) {
  const p = parametros(env);
  const imagem = env.VPS_IMAGEM_ANTERIOR;
  if (!/^sha256:[a-f0-9]{64}$/.test(imagem) || !destino) throw new Error("Imagem ou destino inválido.");
  const privado = mkdtempSync(join(tmpdir(), "barberos-cache-"));
  try {
    const chave = join(privado, "identity");
    const hosts = join(privado, "known_hosts");
    writeFileSync(chave, env.VPS_SSH_KEY.replace(/\r\n/g, "\n").trimEnd() + "\n", { mode: 0o600 });
    writeFileSync(hosts, env.VPS_KNOWN_HOSTS.trimEnd() + "\n", { mode: 0o600 });
    const args = ["-F", "none", "-T", "-p", p.porta, "-i", chave,
      "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "IdentityAgent=none",
      "-o", "StrictHostKeyChecking=yes", "-o", "HostKeyAlgorithms=ssh-ed25519",
      "-o", "GlobalKnownHostsFile=/dev/null", "-o", `UserKnownHostsFile=${hosts}`,
      "-o", "ConnectTimeout=15", `${p.usuario}@${p.host}`,
      `python3 - ${p.base} ${p.projeto} ${imagem} --manutencao`];
    const entrada = readFileSync(new URL("./liberar_cache_build.py", import.meta.url));
    const resposta = executar("ssh", args, { input: entrada, timeout: 300_000,
      maxBuffer: 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
    const r = JSON.parse(resposta.toString());
    if (!["imagensPreservadas", "containersPreservados", "volumesPreservados", "backupsConfiguracaoPreservados"].every(k => r[k] === true)
      || r.escopoCache !== "unused-private-regular" || !Number.isSafeInteger(r.livreDepois)) {
      throw new Error("Preservação não comprovada.");
    }
    writeFileSync(resolve(destino), JSON.stringify(r, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    return r;
  } catch {
    throw new Error("Manutenção não comprovada; detalhes privados não foram exibidos. Não prosseguir com publicação.");
  } finally { rmSync(privado, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.stdout.write(JSON.stringify(manter(process.env, process.argv[2])) + "\n"); }
  catch (erro) { process.stderr.write(erro.message + "\n"); process.exitCode = 1; }
}
