/** Usa segredos do executor e host conhecido; nunca imprime o stderr remoto bruto. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function parametros(env) {
  const obrigatorios = ["VPS_HOST", "VPS_USER", "VPS_SSH_KEY", "VPS_KNOWN_HOSTS"];
  const ausentes = obrigatorios.filter((k) => !env[k]?.trim());
  if (ausentes.length) throw new Error(`Configuração segura ausente: ${ausentes.join(", ")}. Não envie os valores ao chat.`);
  const host = env.VPS_HOST;
  const usuario = env.VPS_USER;
  const porta = env.VPS_PORT || "22";
  const base = env.VPS_DIR || "/opt/barberos";
  const projeto = env.VPS_PROJECT || "barberos";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(host) || !/^[a-z_][a-z0-9_-]*$/.test(usuario)
    || !/^\d+$/.test(porta) || Number(porta) < 1 || Number(porta) > 65535
    || !/^\/[A-Za-z0-9_./-]+$/.test(base) || base.split("/").includes("..") || !/^[a-z0-9][a-z0-9_-]*$/.test(projeto)) {
    throw new Error("Parâmetros de acesso inválidos.");
  }
  return { host, usuario, porta, base, projeto };
}

export function consultar(env, destino, executar = execFileSync) {
  const p = parametros(env);
  if (!destino) throw new Error("Informe um arquivo privado de saída fora do repositório.");
  const privado = mkdtempSync(join(tmpdir(), "barberos-acesso-"));
  try {
    const chave = join(privado, "identity");
    const hosts = join(privado, "known_hosts");
    writeFileSync(chave, env.VPS_SSH_KEY.replace(/\r\n/g, "\n").trimEnd() + "\n", { mode: 0o600 });
    writeFileSync(hosts, env.VPS_KNOWN_HOSTS.trimEnd() + "\n", { mode: 0o600 });
    const entrada = readFileSync(fileURLToPath(new URL("./inspecionar-vps.py", import.meta.url)));
    const args = ["-F", "none", "-T", "-p", p.porta, "-i", chave,
      "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "IdentityAgent=none", "-o", "StrictHostKeyChecking=yes",
      "-o", "HostKeyAlgorithms=ssh-ed25519", "-o", "GlobalKnownHostsFile=/dev/null",
      "-o", `UserKnownHostsFile=${hosts}`, "-o", "ConnectTimeout=10",
      `${p.usuario}@${p.host}`, `python3 - --base-dir ${p.base} --project ${p.projeto}`];
    const stdout = executar("ssh", args, { input: entrada, timeout: 180_000, maxBuffer: 4 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
    const relatorio = JSON.parse(stdout.toString());
    if (relatorio.formato !== 1 || relatorio.somenteLeitura !== true) throw new Error("Resposta de inspeção inválida.");
    writeFileSync(resolve(destino), JSON.stringify(relatorio, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    return { arquivoCriado: true, servicos: relatorio.servicos.length, migracoesConsultadas: Array.isArray(relatorio.migracoes), bloqueios: relatorio.bloqueios.length };
  } catch (erro) {
    if (erro?.stderr) {
      const detalhe = String(erro.stderr);
      const motivo = /Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/.test(detalhe) ? "Identidade do host não validada."
        : /Permission denied/.test(detalhe) ? "Autenticação recusada; conferir autorização da chave existente."
          : /Connection refused/.test(detalhe) ? "Conexão recusada antes da autenticação."
            : /timed out/.test(detalhe) ? "Tempo limite de conexão."
              : "Consulta SSH não concluída; detalhes privados não foram exibidos.";
      throw new Error(motivo);
    }
    throw erro;
  } finally { rmSync(privado, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.stdout.write(JSON.stringify(consultar(process.env, process.argv[2])) + "\n"); }
  catch (erro) { process.stderr.write((erro instanceof Error ? erro.message : "Falha na consulta.") + "\n"); process.exitCode = 1; }
}
