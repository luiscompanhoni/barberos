import { redirect } from "next/navigation";
import { CalendarioConteudoTela } from "@/components/campanhas/CalendarioConteudoTela";
import { GESTAO, sessaoAtual } from "@/lib/auth/sessao";

export const dynamic = "force-dynamic";
export default async function CalendarioConteudo() {
  const sessao = await sessaoAtual();
  if (!sessao || !GESTAO.includes(sessao.papel)) redirect("/");
  return <CalendarioConteudoTela />;
}
