import { redirect } from "next/navigation";
import { RhTela } from "@/components/rh/RhTela";
import { sessaoAtual } from "@/lib/auth/sessao";

export const dynamic = "force-dynamic";

/** RH: funcionarios, comissoes e folha (so o dono: tem salarios). */
export default async function Rh() {
  const s = (await sessaoAtual())!;
  if (s.papel !== "DONO") redirect("/");
  return <RhTela />;
}
