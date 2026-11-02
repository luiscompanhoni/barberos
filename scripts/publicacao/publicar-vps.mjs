/** Transporta imagens/código do commit aprovado e chama o procedimento preservando credenciais. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parametros } from "./consultar-vps.mjs";
import { cifrar } from "./cifrar-relatorio.mjs";

const shell = (valor) => "'" + valor.replace(/'/g, "'\\''") + "'";
const sha = (valor) => createHash("sha256").update(valor).digest("hex");
const privado = mkdtempSync(join(tmpdir(), "barberos-publicar-"));
let consultarRegistro;
let saida;
let resultado = { concluido: false, etapa: "configuracao" };
try {
  const p = parametros(process.env);
  const commit = process.env.GITHUB_SHA;
  const anterior = process.env.VPS_IMAGEM_ANTERIOR;
  if (!/^[a-f0-9]{40}$/.test(commit) || !/^sha256:[a-f0-9]{64}$/.test(anterior)) throw new Error("Identificação da publicação inválida.");
  // Valida a chave pública antes de tocar na VPS.
  cifrar(Buffer.from("validacao"), process.env.RELATORIO_CHAVE_PUBLICA);
  const pasta = process.argv[2];
  saida = process.argv[3];
  const chave = join(privado, "identity");
  const hosts = join(privado, "known_hosts");
  writeFileSync(chave, process.env.VPS_SSH_KEY.replace(/\r\n/g, "\n").trimEnd() + "\n", { mode: 0o600 });
  writeFileSync(hosts, process.env.VPS_KNOWN_HOSTS.trimEnd() + "\n", { mode: 0o600 });
  const args = ["-F", "none", "-T", "-p", p.porta, "-i", chave,
    "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "IdentityAgent=none",
    "-o", "StrictHostKeyChecking=yes", "-o", "HostKeyAlgorithms=ssh-ed25519",
    "-o", "GlobalKnownHostsFile=/dev/null", "-o", `UserKnownHostsFile=${hosts}`,
    "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=4",
    `${p.usuario}@${p.host}`];
  const remoto = (comando, opcoes = {}) => execFileSync("ssh", [...args, comando], {
    timeout: 1200_000, maxBuffer: 4 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"], ...opcoes,
  });
  const executarPython = (codigo, parametros, opcoes) => remoto("python3 -c " + shell(codigo) + " " + parametros.map(shell).join(" "), opcoes);
  const release = `${p.base}/releases/${commit}`;
  consultarRegistro = () => executarPython("import pathlib,sys; p=pathlib.Path(sys.argv[1]); print(p.read_text() if p.is_file() else '{}')", [release + "/operacao.json"]);
  resultado.etapa = "conferencia_capacidade";
  const capacidade = () => JSON.parse(executarPython("import json,shutil,sys; print(json.dumps({'livre':shutil.disk_usage(sys.argv[1]).free,'necessario':int(sys.argv[2])*4+3*1024**3,'arquivoImagens':int(sys.argv[2])}))", [p.base, String(statSync(join(pasta, "imagens.tar.gz")).size)]).toString());
  resultado.capacidade = capacidade();
  if (resultado.capacidade.livre <= resultado.capacidade.necessario) {
    resultado.etapa = "liberar_cache_antigo";
    resultado.cacheBuild = JSON.parse(executarPython(readFileSync(new URL("./liberar_cache_build.py", import.meta.url), "utf8"), [p.base, p.projeto, anterior]).toString());
    resultado.etapa = "conferencia_capacidade";
    resultado.capacidade = capacidade();
  }
  if (resultado.capacidade.livre <= resultado.capacidade.necessario) throw new Error("Reserva de disco insuficiente.");
  resultado.etapa = "receber_codigo";
  const entrega = readFileSync(join(pasta, "entrega.tar.gz"));
  const receber = readFileSync(new URL("./receber_release.py", import.meta.url), "utf8");
  executarPython(receber, [p.base, commit, sha(entrega)], { input: entrega });
  resultado.etapa = "carregar_imagens";
  process.stdout.write("Código conferido; carregando imagens do commit.\n");
  const arquivo = openSync(join(pasta, "imagens.tar.gz"), "r");
  try { remoto("bash -o pipefail -c 'gzip -dc | docker load'", { stdio: [arquivo, "pipe", "pipe"] }); }
  finally { closeSync(arquivo); }
  resultado.etapa = "publicacao";
  process.stdout.write("Imagens recebidas; iniciando backup, ensaio e publicação.\n");
  const comando = ["python3", `${release}/barberos/scripts/publicacao/deploy_vps.py`, "--base", p.base, "--project", p.projeto, "--commit", commit, "--imagem-anterior", anterior];
  resultado = { ...resultado, ...JSON.parse(remoto(comando.map(shell).join(" ")).toString()) };
  if (resultado.concluido !== true || resultado.revisao !== commit) throw new Error("Conclusão não comprovada.");
  process.stdout.write("Publicação confirmada com backup restaurado, HTTPS e worker ativos.\n");
} catch {
  process.stderr.write(`Publicação não concluída na etapa ${resultado.etapa || "remota"}; detalhes privados omitidos.\n`);
  process.exitCode = 1;
} finally {
  try {
    const registro = consultarRegistro ? JSON.parse(consultarRegistro().toString()) : {};
    if (saida) writeFileSync(saida, JSON.stringify(cifrar(Buffer.from(JSON.stringify({ resultado, registro })), process.env.RELATORIO_CHAVE_PUBLICA)), { mode: 0o600, flag: "wx" });
  } catch {
    process.stderr.write("Relatório remoto indisponível; conferir a instalação antes de repetir a publicação.\n");
    process.exitCode = 1;
  }
  rmSync(privado, { recursive: true, force: true });
}
