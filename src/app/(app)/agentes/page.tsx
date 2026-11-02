import { redirect } from "next/navigation";
import { sessaoAtual } from "@/lib/auth/sessao";
import { AgentesTela } from "@/components/agentes/AgentesTela";

export const metadata = { title: "Agentes da Black" };

export default async function AgentesPage() {
  const sessao = await sessaoAtual();
  if (!sessao) redirect("/entrar");
  if (sessao.papel !== "DONO" || process.env.AGENTES_HABILITADOS !== "true") redirect("/");
  return <AgentesTela />;
}
