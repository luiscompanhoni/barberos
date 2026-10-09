import { redirect } from "next/navigation";
import { ChecklistTela } from "@/components/checklist/ChecklistTela";
import { sessaoAtual } from "@/lib/auth/sessao";

export const dynamic = "force-dynamic";

/** Checklist da equipe (dono e gerente/recepcao). */
export default async function Checklist() {
  const s = (await sessaoAtual())!;
  if (s.papel !== "DONO" && s.papel !== "RECEPCAO") redirect("/");
  return <ChecklistTela />;
}
