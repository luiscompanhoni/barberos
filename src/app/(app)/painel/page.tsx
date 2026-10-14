import { redirect } from "next/navigation";
import { PainelTela } from "@/components/painel/PainelTela";
import { sessaoAtual } from "@/lib/auth/sessao";

export default async function Painel() {
  const s = (await sessaoAtual())!;
  if (s.papel === "BARBEIRO") redirect("/minha-agenda");
  return <PainelTela nome={s.nome} />;
}
