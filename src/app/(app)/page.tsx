import { redirect } from "next/navigation";
import { sessaoAtual } from "@/lib/auth/sessao";

export default async function Inicio() {
  const s = await sessaoAtual();
  redirect(s?.papel === "BARBEIRO" ? "/minha-agenda" : s?.papel === "DONO" ? "/painel" : "/recepcao");
}
