// Ensaio local da imagem recém-construída, sem rede nem dados reais.
import { spawnSync } from "node:child_process";

const imagem = process.argv[2];
if (!/^barberos-app:[a-f0-9]{40}$/.test(imagem || "")) {
  throw new Error("Informe apenas a imagem de publicação identificada pelo commit.");
}
const verificar = `
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const uid = process.getuid(), gid = process.getgid();
if (!uid || !gid) throw new Error("Aplicação não está usando usuário sem privilégios.");
function visitar(p) {
  const s = fs.lstatSync(p);
  if (s.uid !== uid || s.gid !== gid) throw new Error("Proprietário incorreto: " + p);
  if (s.isDirectory()) for (const n of fs.readdirSync(p)) visitar(path.join(p, n));
}
visitar("/app");
if (fs.readdirSync("/app").some(n => n === ".env" || n.startsWith(".env.")))
  throw new Error("Arquivo .env inesperado na imagem.");
const teste = "/app/media/.verificacao-escrita";
fs.writeFileSync(teste, "teste"); fs.unlinkSync(teste);
const prisma = spawnSync("prisma", ["--version"], {
  encoding: "utf8", timeout: 30000,
  env: { ...process.env, HOME: "/tmp", CHECKPOINT_DISABLE: "1" },
});
if (prisma.status !== 0) throw new Error("CLI Prisma indisponível para migrações.");
`;
const resultado = spawnSync("docker", [
  "run", "--rm", "--network", "none", "--entrypoint", "node",
  imagem, "-e", verificar,
], { encoding: "utf8", timeout: 120000 });
if (resultado.error || resultado.status !== 0) {
  throw new Error("Verificação da imagem falhou: " + (resultado.stderr || resultado.error?.message || "erro desconhecido"));
}
// Um volume anônimo novo exercita a cópia inicial do diretório pelo Docker.
const volume = spawnSync("docker", [
  "run", "--rm", "--network", "none", "--mount", "type=volume,dst=/app/media",
  "--entrypoint", "node", imagem, "-e",
  "const fs=require('node:fs');const p='/app/media/.teste-volume';fs.writeFileSync(p,'teste');fs.unlinkSync(p)",
], { encoding: "utf8", timeout: 120000 });
if (volume.error || volume.status !== 0) {
  throw new Error("Verificação do volume novo falhou: " + (volume.stderr || volume.error?.message || "erro desconhecido"));
}
console.log("Imagem: usuário, propriedade dos arquivos, mídia, volume novo e CLI Prisma conferidos.");
