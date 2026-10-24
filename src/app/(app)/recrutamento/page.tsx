import { redirect } from "next/navigation";
import { sessaoAtual } from "@/lib/auth/sessao";
import { podeRecrutar } from "@/lib/recrutamento/regras";
import { RecrutamentoTela } from "@/components/recrutamento/RecrutamentoTela";
export const dynamic = "force-dynamic";
export default async function Pagina() {
  const s = await sessaoAtual();
  if (!s || !podeRecrutar(s.papel)) redirect("/painel");
  return <RecrutamentoTela />;
}
