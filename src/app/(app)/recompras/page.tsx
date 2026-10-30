import { exigirSessao } from "@/lib/auth/sessao";
import { RecomprasConfiguracao } from "@/components/recompras/RecomprasConfiguracao";
export default async function RecomprasPage() {
  await exigirSessao(["DONO"]);
  return <RecomprasConfiguracao />;
}
