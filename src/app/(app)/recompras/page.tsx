import { redirect } from "next/navigation";
import { sessaoAtual } from "@/lib/auth/sessao";
import { RecomprasConfiguracao } from "@/components/recompras/RecomprasConfiguracao";
export default async function RecomprasPage() {
  const sessao = await sessaoAtual();
  if (!sessao) redirect("/entrar");
  if (sessao.papel === "CLIENTE") redirect("/c");
  if (sessao.papel !== "DONO") redirect("/");
  return <RecomprasConfiguracao />;
}
