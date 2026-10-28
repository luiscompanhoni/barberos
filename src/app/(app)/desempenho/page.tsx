import { DesempenhoTela } from "@/components/desempenho/DesempenhoTela";
import { exigirSessao } from "@/lib/auth/sessao";

export const dynamic = "force-dynamic";

export default async function DesempenhoPage() {
  await exigirSessao();
  return <DesempenhoTela />;
}
