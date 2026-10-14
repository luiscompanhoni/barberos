import { redirect } from "next/navigation";
import { PlanosTela } from "@/components/assinaturas/PlanosTela";
import { GESTAO, sessaoAtual } from "@/lib/auth/sessao";

export default async function Planos() {
  const s = (await sessaoAtual())!;
  if (!GESTAO.includes(s.papel)) redirect("/");
  return <PlanosTela />;
}
