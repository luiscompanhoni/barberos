import { redirect } from "next/navigation";
import { GESTAO, sessaoAtual } from "@/lib/auth/sessao";

export default async function Inicio() {
  const s = await sessaoAtual();
  if (s?.papel === "BARBEIRO") redirect(s.barbeiroId ? "/minha-agenda" : "/conta");
  redirect(s && GESTAO.includes(s.papel) ? "/painel" : "/recepcao");
}
