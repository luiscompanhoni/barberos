import { redirect } from "next/navigation";
import { CaixaOperacaoTela } from "@/components/financeiro/CaixaOperacaoTela";
import { BALCAO, sessaoAtual } from "@/lib/auth/sessao";

export const dynamic = "force-dynamic";

export default async function Caixa() {
  const s = (await sessaoAtual())!;
  if (!BALCAO.includes(s.papel)) redirect("/");
  return <CaixaOperacaoTela />;
}
