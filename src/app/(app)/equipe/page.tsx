import { redirect } from "next/navigation";
import { AutomacoesTela } from "@/components/AutomacoesTela";
import { AcessosTela } from "@/components/conta/AcessosTela";
import { ConfiguracaoTela } from "@/components/ConfiguracaoTela";
import { EquipeTela } from "@/components/EquipeTela";
import { BackupsTela } from "@/components/conta/BackupsTela";
import { PermissoesTela } from "@/components/conta/PermissoesTela";
import { GESTAO, sessaoAtual } from "@/lib/auth/sessao";

export default async function Equipe() {
  const s = (await sessaoAtual())!;
  if (!GESTAO.includes(s.papel)) redirect("/");
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <ConfiguracaoTela />
      <AutomacoesTela />
      {s.papel === "DONO" && <AcessosTela />}
      {s.papel === "DONO" && <PermissoesTela />}
      {s.papel === "DONO" && <BackupsTela />}
      <EquipeTela />
    </div>
  );
}
