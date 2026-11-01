/** Empacota somente um commit limpo. Não conecta à VPS nem executa deploy. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function preparar(repo, destino) {
  const git = (...args) => execFileSync("git", ["-C", repo, ...args], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 });
  const raiz = realpathSync(git("rev-parse", "--show-toplevel").toString().trim());
  if (realpathSync(repo) !== raiz) throw new Error("Informe a raiz do repositório.");
  if (git("status", "--porcelain=v1", "--untracked-files=all").length) {
    throw new Error("Há alterações ou arquivos novos sem commit. Preserve-os e revise a versão antes de empacotar.");
  }
  const commit = git("rev-parse", "HEAD").toString().trim();
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Commit inválido.");
  const saida = resolve(destino ?? join(tmpdir(), `barberos-${commit}`));
  const caminhoRelativo = relative(raiz, saida);
  if (!caminhoRelativo || (!isAbsolute(caminhoRelativo) && caminhoRelativo !== ".." && !caminhoRelativo.startsWith(`..${sep}`))) {
    throw new Error("O pacote deve ficar fora da cópia de trabalho.");
  }
  if (existsSync(saida)) throw new Error("O destino já existe; nenhum arquivo foi sobrescrito.");

  const entries = git("ls-tree", "-r", "-z", commit).toString().split("\0").filter(Boolean);
  const arquivos = [];
  const migracoes = [];
  for (const entry of entries) {
    const [info, nome] = entry.split("\t");
    const [modo, tipo] = info.split(" ");
    if (tipo !== "blob" || !["100644", "100755"].includes(modo)) throw new Error(`Arquivo especial não permitido no pacote: ${nome}`);
    const folha = basename(nome);
    if ((/^\.env(?:\.|$)/.test(folha) && folha !== ".env.example") || /\.(pem|key|p12|pfx|sql\.gz|dump)$/i.test(folha)
      || /^(id_rsa|id_ed25519|\.senha-homolog)/.test(folha) || /^backups(\/|$)/.test(nome)
      || /(^|\/)(\.data|\.test-estudio|node_modules|\.next)(\/|$)/.test(nome)) {
      throw new Error(`Arquivo privado ou gerado versionado: ${nome}. Retire-o da versão antes de preparar.`);
    }
    const bytes = git("show", `${commit}:${nome}`);
    const texto = bytes.toString("utf8");
    if (/-----BEGIN (?:[A-Z ]+)?PRIVATE KEY-----/.test(texto)
      || /\b(?:gh[pousr]_[A-Za-z0-9_]{24,}|github_pat_[A-Za-z0-9_]{24,}|sk-(?:proj-|ant-)[A-Za-z0-9_-]{24,})/.test(texto)) {
      throw new Error(`Possível credencial em ${nome}; conteúdo não exibido.`);
    }
    arquivos.push({ caminho: nome, sha256: digest(bytes), modo });
    if (/^prisma\/migrations\/[^/]+\/migration\.sql$/.test(nome)) migracoes.push({ nome: nome.split("/")[2], sha256: digest(bytes) });
  }
  const pacote = JSON.parse(git("show", `${commit}:package.json`).toString());
  mkdirSync(saida, { recursive: true, mode: 0o700 });
  git("archive", "--format=tar.gz", "--prefix=barberos/", `--output=${join(saida, "codigo.tar.gz")}`, commit);
  const manifesto = {
    formato: 1, commit, criadoEm: new Date().toISOString(),
    next: pacote.dependencies?.next ?? null,
    incluiStudio: arquivos.some((a) => a.caminho === "workers/video/package.json"),
    codigoSha256: digest(readFileSync(join(saida, "codigo.tar.gz"))),
    migracoes, arquivos,
    estado: "preparado; não publicado",
  };
  writeFileSync(join(saida, "versao.json"), JSON.stringify(manifesto, null, 2) + "\n", { mode: 0o600 });
  writeFileSync(join(saida, "SHA256SUMS"), ["codigo.tar.gz", "versao.json"].map((nome) => `${digest(readFileSync(join(saida, nome)))}  ${nome}\n`).join(""), { mode: 0o600 });
  return { commit, destino: saida, migracoes: migracoes.length, incluiStudio: manifesto.incluiStudio };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.stdout.write(JSON.stringify(preparar(process.cwd(), process.argv[2])) + "\n"); }
  catch (erro) { process.stderr.write((erro instanceof Error ? erro.message : "Falha ao preparar pacote.") + "\n"); process.exitCode = 1; }
}
