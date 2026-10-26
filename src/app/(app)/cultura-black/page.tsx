import { CulturaBlackTela } from "@/components/cultura-black/CulturaBlackTela";
import { redirect } from "next/navigation";
import { sessaoAtual } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { linkDoChecklist } from "@/lib/cultura-black/checklist-link";

export const dynamic = "force-dynamic";

/** Conteúdo interno da equipe, servido dentro do layout autenticado do BarberOS. */
export default async function CulturaBlack() {
  const sessao = await sessaoAtual();
  if (!sessao) redirect("/entrar");
  if (sessao.papel === "CLIENTE") redirect("/c");
  const checklist = sessao.papel === "BARBEIRO" && sessao.barbeiroId
    ? await db.checklistPessoa.findUnique({ where: { barbeiroId: sessao.barbeiroId }, select: { ativo: true, token: true } })
    : null;
  const hrefChecklist = linkDoChecklist(sessao.papel, checklist?.ativo ? checklist.token : null);

  return <CulturaBlackTela hrefChecklist={hrefChecklist} />;
}
