/** Remove imagens antigas do BarberOS na VPS (por padrão só lista); não toca containers, volumes, .env ou backups. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parametros } from "./consultar-vps.mjs";

const GB = 1024 ** 3;

export function limparImagens(env, destino, executar = execFileSync) {
  const p = parametros(env);
  const imagem = env.VPS_IMAGEM_ANTERIOR;
  const remover = env.REMOVER_IMAGENS === "true";
  if (!/^sha256:[a-f0-9]{64}$/.test(imagem) || !destino) throw new Error("Imagem ou destino inválido.");
  const privado = mkdtempSync(join(tmpdir(), "barberos-imagens-"));
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
      `python3 - ${p.base} ${p.projeto} ${imagem}${remover ? " --remover" : ""}`];
    const entrada = readFileSync(new URL("./limpar_imagens_antigas.py", import.meta.url));
    const r = JSON.parse(executar("ssh", args, { input: entrada, timeout: 600_000,
      maxBuffer: 4 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] }).toString());
    if (!Array.isArray(r.remover) || !Array.isArray(r.manter) || !Number.isSafeInteger(r.livreDepois)
      || r.removido !== (remover && r.remover.length > 0)
      || (r.removido && !["containersPreservados", "volumesPreservados", "imagensMantidasPreservadas", "backupsConfiguracaoPreservados"].every(k => r[k] === true))) {
      throw new Error("Preservação não comprovada.");
    }
    writeFileSync(resolve(destino), JSON.stringify(r, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    return r;
  } catch {
    throw new Error("Limpeza não comprovada; detalhes privados não foram exibidos. Não prosseguir com publicação.");
  } finally { rmSync(privado, { recursive: true, force: true }); }
}

export function resumo(r) {
  const gb = (n) => (n / GB).toFixed(1) + " GB";
  return [
    `Versão no ar: ${r.commitNoAr.slice(0, 7)}; mantidas: ${r.manterCommits.map(c => c.slice(0, 7)).join(", ")}.`,
    `${r.removido ? "Removidas" : "Seriam removidas"} ${r.remover.length} tags (estimativa ${gb(r.estimativaLiberadaBytes)}); mantidas ${r.manter.length}.`,
    ...r.remover.map(i => `  - ${i.repo}:${i.tag.slice(0, 13)}`),
    `Livre antes: ${gb(r.livreAntes)}; depois: ${gb(r.livreDepois)}.`,
  ].join("\n") + "\n";
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.stdout.write(resumo(limparImagens(process.env, process.argv[2]))); }
  catch (erro) { process.stderr.write(erro.message + "\n"); process.exitCode = 1; }
}
