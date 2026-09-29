import { redirect } from "next/navigation";
import { SimuladorTela } from "@/components/conversas/SimuladorTela";
import { sessaoAtual } from "@/lib/auth/sessao";
import { provedorWhatsApp } from "@/lib/whatsapp/canal";

export default async function Simulador() {
  const s = (await sessaoAtual())!;
  if (s.papel !== "DONO" || provedorWhatsApp() !== "simulador") redirect("/");
  // Sem credencial o bot passa tudo para a equipe; o aviso evita confusao no teste.
  return <SimuladorTela semChave={!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN} />;
}
