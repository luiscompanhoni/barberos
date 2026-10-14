import { redirect } from "next/navigation";
import { AuditoriaTela } from "@/components/auditoria/AuditoriaTela";
import { sessaoAtual } from "@/lib/auth/sessao";

export const dynamic = "force-dynamic";

/** Log de auditoria: quem mudou o que, quando e de onde (so o dono). */
export default async function Auditoria() {
  const s = (await sessaoAtual())!;
  if (s.papel !== "DONO") redirect("/");
  return <AuditoriaTela />;
}
