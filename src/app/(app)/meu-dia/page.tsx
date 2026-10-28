import { exigirSessao } from "@/lib/auth/sessao";
import { MeuDiaTela } from "@/components/reunioes/MeuDiaTela";

export default async function MeuDiaPage() {
  await exigirSessao();
  return <MeuDiaTela />;
}
