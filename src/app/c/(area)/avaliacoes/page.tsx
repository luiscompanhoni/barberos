import { AvaliacaoCliente } from "@/components/avaliacoes/AvaliacaoCliente";
import { exigirCliente } from "@/lib/auth/sessao";

export const dynamic = "force-dynamic";
export default async function AvaliarVisita() {
  await exigirCliente();
  return <AvaliacaoCliente />;
}
