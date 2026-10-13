import { redirect } from "next/navigation";
import { PlanosTela } from "@/components/assinaturas/PlanosTela";
import { sessaoAtual } from "@/lib/auth/sessao";

export default async function Planos() {
  const s = (await sessaoAtual())!;
  if (s.papel !== "DONO") redirect("/");
  return <PlanosTela />;
}
