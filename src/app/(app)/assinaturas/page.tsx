import { redirect } from "next/navigation";
import { AssinaturasTela } from "@/components/assinaturas/AssinaturasTela";
import { pode } from "@/lib/auth/permissoes";
import { sessaoAtual } from "@/lib/auth/sessao";

export default async function Assinaturas() {
  const s = (await sessaoAtual())!;
  if (s.papel === "BARBEIRO") redirect("/");
  return <AssinaturasTela podeCancelar={await pode(s, "assinatura")} />;
}
