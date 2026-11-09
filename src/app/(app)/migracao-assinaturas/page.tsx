import { redirect } from "next/navigation";
import { MigracaoAssinaturasTela } from "@/components/assinaturas/MigracaoAssinaturasTela";
import { GESTAO, sessaoAtual } from "@/lib/auth/sessao";

export const dynamic = "force-dynamic";
export default async function MigracaoAssinaturas() {
  const s = await sessaoAtual();
  if (!s || !GESTAO.includes(s.papel)) redirect("/");
  return <MigracaoAssinaturasTela />;
}
