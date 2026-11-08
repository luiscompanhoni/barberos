import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ErroNegocio } from "@/lib/erros";
import { analisarChavePix } from "./pix-regras";

export type CadastroPixProtegido = { chavePix: string | null; chavePixCifrada?: string | null; chavePixMascarada?: string | null; chavePixTipo?: string | null; chavePixHash?: string | null };
const indisponivel = () => new ErroNegocio("Proteção de chaves Pix indisponível. Fale com o dono antes de alterar o cadastro.", 503, "pix_protecao_indisponivel");

function segredo() {
  const texto = process.env.RH_PIX_ENCRYPTION_KEY ?? "";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(texto)) throw indisponivel();
  const chave = Buffer.from(texto, "base64");
  if (chave.length !== 32 || chave.toString("base64") !== texto) throw indisponivel();
  return chave;
}
export function exigirProtecaoPix() { segredo(); }
const aad = (pessoaId: string) => Buffer.from(`barberos:rh-pix:v1:${pessoaId}`);
const hashChave = (valor: string) => createHmac("sha256", segredo()).update(`barberos:rh-pix:dedup:${valor}`).digest("hex");

export function protegerChavePix(pessoaId: string, valor: string | null) {
  if (valor === null) return { chavePix: null, chavePixCifrada: null, chavePixMascarada: null, chavePixTipo: null, chavePixHash: null };
  const analise = analisarChavePix(valor);
  if (analise.problema) throw new ErroNegocio(analise.problema, 400, "pix_invalido");
  const iv = randomBytes(12), cifrador = createCipheriv("aes-256-gcm", segredo(), iv);
  cifrador.setAAD(aad(pessoaId));
  const cifrado = Buffer.concat([cifrador.update(analise.normalizada, "utf8"), cifrador.final()]);
  const chavePixCifrada = ["v1", iv.toString("base64url"), cifrado.toString("base64url"), cifrador.getAuthTag().toString("base64url")].join(":");
  return { chavePix: null, chavePixCifrada, chavePixMascarada: analise.mascarada, chavePixTipo: analise.tipo!, chavePixHash: hashChave(analise.normalizada) };
}

/** Uso interno para validar restauração e integridade; nenhum endpoint revela o valor. */
export function decifrarChavePix(pessoaId: string, valor: string) {
  const chave = segredo();
  try {
    const partes = valor.split(":");
    if (partes.length !== 4 || partes[0] !== "v1" || partes.slice(1).some(p => !/^[A-Za-z0-9_-]+$/.test(p))) throw new Error();
    const iv = Buffer.from(partes[1], "base64url"), tag = Buffer.from(partes[3], "base64url");
    if (iv.length !== 12 || tag.length !== 16) throw new Error();
    const decifrador = createDecipheriv("aes-256-gcm", chave, iv);
    decifrador.setAAD(aad(pessoaId)); decifrador.setAuthTag(tag);
    return Buffer.concat([decifrador.update(Buffer.from(partes[2], "base64url")), decifrador.final()]).toString("utf8");
  } catch { throw new ErroNegocio("Não foi possível validar a chave Pix protegida. Restaure a configuração de proteção e confira o cadastro.", 409, "pix_integridade"); }
}

export function resumoPix(p: CadastroPixProtegido) {
  if (p.chavePixCifrada) return { mascara: p.chavePixMascarada ?? "••••", tipo: p.chavePixTipo ?? null, estado: p.chavePix ? "CONFLITO" : "PROTEGIDA" };
  if (p.chavePix) return { mascara: analisarChavePix(p.chavePix).mascarada, tipo: analisarChavePix(p.chavePix).tipo, estado: "LEGADO_PENDENTE" };
  return { mascara: "Não cadastrada", tipo: null, estado: "AUSENTE" };
}

export function conferirPixProtegido(pessoaId: string, p: CadastroPixProtegido) {
  const resumo = resumoPix(p);
  let problema: string | null = null;
  if (resumo.estado === "AUSENTE") problema = "Chave Pix ausente.";
  else if (resumo.estado !== "PROTEGIDA" || !p.chavePixHash || !p.chavePixTipo || !p.chavePixMascarada) problema = "Chave Pix legada ou incompleta: proteção e conferência pendentes.";
  else {
    try {
      const analise = analisarChavePix(decifrarChavePix(pessoaId, p.chavePixCifrada!));
      const atual = hashChave(analise.normalizada), salvo = p.chavePixHash;
      if (analise.problema || atual.length !== salvo.length || !timingSafeEqual(Buffer.from(atual), Buffer.from(salvo))
        || analise.tipo !== p.chavePixTipo || analise.mascarada !== p.chavePixMascarada) problema = "A chave Pix mudou ou a proteção está inconsistente.";
    } catch { problema = "Não foi possível conferir a proteção da chave Pix. Nenhum envio está autorizado."; }
  }
  return { ...resumo, hash: p.chavePixHash ?? "", problema };
}
