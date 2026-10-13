import { redirect } from "next/navigation";
import { IndicadoresTela } from "@/components/indicadores/IndicadoresTela";
import { sessaoAtual } from "@/lib/auth/sessao";

export default async function Indicadores() {
  const s = (await sessaoAtual())!;
  if (s.papel === "BARBEIRO" && s.barbeiroId) redirect(`/indicadores/barbeiro/${s.barbeiroId}`);
  if (s.papel !== "DONO") redirect("/");
  return <IndicadoresTela />;
}
