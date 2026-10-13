/**
 * Senhas com scrypt (embutido no Node, sem dependencia). Formato guardado:
 *   scrypt$N$r$p$salt(base64)$hash(base64)
 */
import { randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

const N = 16384, R = 8, P = 1, TAMANHO = 64;

function scrypt(senha: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((ok, erro) => scryptCb(senha, salt, TAMANHO, opts, (e, chave) => (e ? erro(e) : ok(chave))));
}

export async function gerarHash(senha: string) {
  const salt = randomBytes(16);
  const chave = await scrypt(senha.normalize("NFKC"), salt, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${chave.toString("base64")}`;
}

export async function conferirSenha(senha: string, guardado: string | null | undefined) {
  if (!guardado) return false;
  const [alg, n, r, p, salt, hash] = guardado.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const esperado = Buffer.from(hash, "base64");
  const chave = await scrypt(senha.normalize("NFKC"), Buffer.from(salt, "base64"), { N: Number(n), r: Number(r), p: Number(p) });
  return chave.length === esperado.length && timingSafeEqual(chave, esperado);
}

/** Motivo pelo qual a senha e fraca (ou null se esta boa). */
export function problemaDaSenha(senha: string, telefone?: string) {
  if (senha.length < 8) return "A senha precisa de pelo menos 8 caracteres.";
  if (senha.length > 128) return "Senha longa demais.";
  if (/^(\d)\1+$/.test(senha) || ["12345678", "123456789", "senha123", "password"].includes(senha.toLowerCase())) return "Essa senha é fácil demais de adivinhar.";
  const digitos = telefone?.replace(/\D/g, "") ?? "";
  if (digitos && digitos.slice(-8) && senha.replace(/\D/g, "").includes(digitos.slice(-8))) return "Não use o seu celular como senha.";
  return null;
}

/** Senha temporaria facil de ditar (o dono passa para o barbeiro; ele troca no 1o acesso). */
export function senhaTemporaria() {
  const palavras = ["corte", "barba", "navalha", "tesoura", "pente", "toalha", "espuma", "cadeira"];
  return `${palavras[randomInt(palavras.length)]}-${randomInt(1000, 9999)}-${palavras[randomInt(palavras.length)]}`;
}
