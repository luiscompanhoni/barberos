import { redirect } from "next/navigation";
import { EstoqueTela } from "@/components/comandas/EstoqueTela";
import { BALCAO, GESTAO, sessaoAtual } from "@/lib/auth/sessao";

export default async function Estoque() {
  const s = (await sessaoAtual())!;
  if (!BALCAO.includes(s.papel)) redirect("/");
  return <EstoqueTela podeCadastrar={GESTAO.includes(s.papel)} />;
}
