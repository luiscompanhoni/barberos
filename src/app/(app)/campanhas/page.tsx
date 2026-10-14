import { redirect } from "next/navigation";
import { CampanhasTela } from "@/components/campanhas/CampanhasTela";
import { GESTAO, sessaoAtual } from "@/lib/auth/sessao";

export const dynamic = "force-dynamic";

/** Segmentos, capacidade da agenda e campanhas em lotes (dono e gerente). */
export default async function Campanhas() {
  const s = (await sessaoAtual())!;
  if (!GESTAO.includes(s.papel)) redirect("/");
  return <CampanhasTela />;
}
