/** Testa somente autenticação SSH. Não imprime credenciais nem a saída remota. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function verificar(env, executar = execFileSync) {
  const nomes = ["VPS_HOST", "VPS_USER", "VPS_SSH_KEY", "VPS_KNOWN_HOSTS"];
  const ausentes = nomes.filter((nome) => !env[nome]?.trim());
  if (ausentes.length) throw new Error(`Cadastro ausente no ambiente produção: ${ausentes.join(", ")}.`);
  const host = env.VPS_HOST.trim();
  const usuario = env.VPS_USER.trim();
  const porta = env.VPS_PORT?.trim() || "22";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(host) || !/^[a-z_][a-z0-9_-]*$/.test(usuario)
    || !/^\d+$/.test(porta) || Number(porta) < 1 || Number(porta) > 65535) {
    throw new Error("Conferir as variáveis VPS_HOST, VPS_USER e VPS_PORT; formato inválido.");
  }
  const pasta = mkdtempSync(join(tmpdir(), "barberos-conexao-"));
  try {
    const chave = join(pasta, "identity");
    const hosts = join(pasta, "known_hosts");
    writeFileSync(chave, env.VPS_SSH_KEY.replace(/\r\n/g, "\n").trimEnd() + "\n", { mode: 0o600 });
    writeFileSync(hosts, env.VPS_KNOWN_HOSTS.replace(/\r\n/g, "\n").trimEnd() + "\n", { mode: 0o600 });
    const args = ["-F", "none", "-T", "-p", porta, "-i", chave,
      "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "IdentityAgent=none",
      "-o", "StrictHostKeyChecking=yes", "-o", "HostKeyAlgorithms=ssh-ed25519",
      "-o", "GlobalKnownHostsFile=/dev/null", "-o", `UserKnownHostsFile=${hosts}`,
      "-o", "PasswordAuthentication=no", "-o", "KbdInteractiveAuthentication=no",
      "-o", "ConnectTimeout=15", "-o", "ConnectionAttempts=1",
      `${usuario}@${host}`, "printf 'BARBEROS_SSH_OK\\n'"];
    let stdout;
    try {
      const ambienteFilho = { ...env };
      delete ambienteFilho.VPS_SSH_KEY;
      delete ambienteFilho.VPS_KNOWN_HOSTS;
      stdout = executar("ssh", args, {
        env: ambienteFilho, timeout: 30_000, maxBuffer: 64 * 1024, stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (erro) {
      const detalhe = String(erro?.stderr || "");
      const motivo = /Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/.test(detalhe)
        ? "Identidade da VPS não confirmada; conferir VPS_KNOWN_HOSTS sem desativar a verificação."
        : /invalid format|error in libcrypto/.test(detalhe)
          ? "VPS_SSH_KEY não foi reconhecida; conferir se a chave privada completa foi colada no Secret."
          : /Permission denied/.test(detalhe)
            ? "A VPS recusou a chave; conferir o cadastro de VPS_SSH_KEY e a autorização na VPS."
            : /Connection refused/.test(detalhe)
              ? "A VPS recusou a conexão na porta SSH, antes da autenticação."
              : /timed out/.test(detalhe) || erro?.code === "ETIMEDOUT"
                ? "A conexão SSH excedeu o tempo limite."
                : "Conexão SSH não concluída; detalhes privados omitidos.";
      throw new Error(motivo);
    }
    if (stdout.toString().trim() !== "BARBEROS_SSH_OK") {
      throw new Error("A resposta SSH não confirmou o teste; conteúdo remoto omitido.");
    }
    return "Conexão GitHub → VPS validada por chave, com identidade do servidor conferida. Nenhum deploy executado.";
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.stdout.write(verificar(process.env) + "\n"); }
  catch (erro) {
    // Somente mensagens controladas acima; erros locais não podem revelar caminhos/valores.
    const mensagem = erro instanceof Error && !erro.code ? erro.message : "Não foi possível preparar o teste SSH.";
    process.stderr.write(mensagem + "\n");
    process.exitCode = 1;
  }
}
