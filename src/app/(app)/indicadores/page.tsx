import { redirect } from "next/navigation";
import { pode } from "@/lib/auth/permissoes";
import { sessaoAtual } from "@/lib/auth/sessao";

export default async function Indicadores() {
  const s = (await sessaoAtual())!;
  if (s.papel === "BARBEIRO" && s.barbeiroId) redirect(`/indicadores/barbeiro/${s.barbeiroId}`);
  if (!(await pode(s, "resultado"))) redirect("/");
  redirect("/financeiro?area=empresa&aba=indicadores");
}
