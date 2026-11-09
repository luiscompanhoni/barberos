import { redirect } from "next/navigation";
import { MetasCrescimentoTela } from "@/components/campanhas/MetasCrescimentoTela";
import { pode } from "@/lib/auth/permissoes";
import { LIDERANCA, sessaoAtual } from "@/lib/auth/sessao";

export const dynamic = "force-dynamic";
export default async function Crescimento() {
  const sessao = await sessaoAtual();
  if (!sessao || !LIDERANCA.includes(sessao.papel) || !(await pode(sessao, "lucro"))) redirect("/");
  return <MetasCrescimentoTela />;
}
