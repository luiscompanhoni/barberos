import { redirect } from "next/navigation";
import { ChecklistTela } from "@/components/checklist/ChecklistTela";
import { BALCAO, sessaoAtual } from "@/lib/auth/sessao";

export const dynamic = "force-dynamic";

/** Checklist da equipe (dono e gerente/recepcao). */
export default async function Checklist() {
  const s = (await sessaoAtual())!;
  if (!BALCAO.includes(s.papel)) redirect("/");
  return <ChecklistTela />;
}
