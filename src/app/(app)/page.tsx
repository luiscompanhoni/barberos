import { redirect } from "next/navigation";
import { GESTAO, sessaoAtual } from "@/lib/auth/sessao";

export default async function Inicio() {
  const s = await sessaoAtual();
  redirect(s?.papel === "BARBEIRO" ? "/minha-agenda" : s && GESTAO.includes(s.papel) ? "/painel" : "/recepcao");
}
