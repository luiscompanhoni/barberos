import { redirect } from "next/navigation";
import { RotasCaptacao } from "@/components/campanhas/rotas/RotasCaptacao";
import { GESTAO, sessaoAtual } from "@/lib/auth/sessao";

export const metadata = { title: "Rotas de captação · BarberOS" };
export const dynamic = "force-dynamic";

export default async function PaginaRotasCaptacao() {
  const sessao = await sessaoAtual();
  if (!sessao) redirect("/entrar");
  if (!GESTAO.includes(sessao.papel)) redirect("/");

  return <RotasCaptacao conta={sessao.usuarioId} />;
}
