import { redirect } from "next/navigation";
import { RhTela } from "@/components/rh/RhTela";
import { permissoesDoUsuario } from "@/lib/auth/permissoes";
import { sessaoAtual } from "@/lib/auth/sessao";

export const dynamic = "force-dynamic";

/** RH: funcionarios, comissoes e folha (tem salarios: dono e quem tem as permissoes "folha" ou "comissao"). */
export default async function Rh() {
  const s = (await sessaoAtual())!;
  const p = await permissoesDoUsuario(s);
  if (!p.folha && !p.comissao) redirect("/");
  return <RhTela />;
}
