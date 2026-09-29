import { redirect } from "next/navigation";
import { ConfiguracaoTela } from "@/components/ConfiguracaoTela";
import { EquipeTela } from "@/components/EquipeTela";
import { sessaoAtual } from "@/lib/auth/sessao";

export default async function Equipe() {
  const s = (await sessaoAtual())!;
  if (s.papel !== "DONO") redirect("/");
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <ConfiguracaoTela />
      <EquipeTela />
    </div>
  );
}
