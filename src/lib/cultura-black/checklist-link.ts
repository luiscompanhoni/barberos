import { BALCAO } from "@/lib/auth/sessao";
import type { Papel } from "@prisma/client";

/** Destinos existentes do checklist: painel para balcão/gestão e link pessoal para barbeiro. */
export function linkDoChecklist(papel: Papel, tokenPessoal?: string | null) {
  if (papel === "BARBEIRO" || papel === "LIDER") return tokenPessoal ? `/t/${encodeURIComponent(tokenPessoal)}` : null;
  return BALCAO.includes(papel) ? "/checklist" : null;
}
