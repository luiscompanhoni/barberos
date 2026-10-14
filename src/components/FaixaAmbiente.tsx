import { connection } from "next/server";
import { ehHomologacao } from "@/lib/ambiente";

/** Faixa fixa no topo da homologacao: ninguem confunde com o sistema de verdade. */
export async function FaixaAmbiente() {
  await connection(); // AMBIENTE vem do servidor em execucao, nao do build
  if (!ehHomologacao()) return null;
  return (
    <div className="sticky top-0 z-[60] bg-amber-400 px-3 py-1 text-center text-xs font-bold text-black">
      HOMOLOGAÇÃO · ambiente de testes: nada é enviado no WhatsApp nem cobrado de verdade
    </div>
  );
}
