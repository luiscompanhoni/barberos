import { redirect } from "next/navigation";
import { AvaliacoesTela } from "@/components/avaliacoes/AvaliacoesTela";
import { pode } from "@/lib/auth/permissoes";
import { LIDERANCA, sessaoAtual } from "@/lib/auth/sessao";

export const dynamic = "force-dynamic";
export default async function Avaliacoes() {
  const s = await sessaoAtual();
  if (!s) redirect("/entrar");
  if (LIDERANCA.includes(s.papel) ? !await pode(s, "avaliar_equipe") : !s.barbeiroId) redirect("/");
  return <AvaliacoesTela />;
}
