import { readFile, stat } from "node:fs/promises";
import type { Papel } from "@prisma/client";
import type { Permissoes } from "@/lib/auth/permissoes-regras";
import { GESTAO } from "@/lib/auth/sessao";
import { naoEncontrado } from "@/lib/erros";

export function podeVerDemonstrativo(papel: Papel, p: Pick<Permissoes, "folha" | "comissao" | "lucro">) {
  return GESTAO.includes(papel) && p.lucro && (p.folha || p.comissao);
}

export async function demonstrativoDisponivel() {
  const arquivo = process.env.DEMONSTRATIVO_RH_ARQUIVO;
  if (!arquivo) return false;
  return stat(/* turbopackIgnore: true */ arquivo).then(info => info.isFile(), () => false);
}

export async function lerDemonstrativo() {
  const arquivo = process.env.DEMONSTRATIVO_RH_ARQUIVO;
  if (!arquivo) throw naoEncontrado("Demonstrativo");
  try {
    return new Uint8Array(await readFile(/* turbopackIgnore: true */ arquivo));
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code === "ENOENT") throw naoEncontrado("Demonstrativo");
    throw erro;
  }
}
