import { redirect } from "next/navigation";
import { AssinaturasTela } from "@/components/assinaturas/AssinaturasTela";
import { sessaoAtual } from "@/lib/auth/sessao";

export default async function Assinaturas() {
  const s = (await sessaoAtual())!;
  if (s.papel === "BARBEIRO") redirect("/");
  return <AssinaturasTela dono={s.papel === "DONO"} />;
}
