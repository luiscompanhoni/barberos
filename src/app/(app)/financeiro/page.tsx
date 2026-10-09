import { redirect } from "next/navigation";
import { FinanceiroTela } from "@/components/financeiro/FinanceiroTela";
import { sessaoAtual } from "@/lib/auth/sessao";

export const dynamic = "force-dynamic";

/** Caixa, despesas e conciliacao (dono e gerente/recepcao); resumo do mes so o dono. */
export default async function Financeiro() {
  const s = (await sessaoAtual())!;
  if (s.papel !== "DONO" && s.papel !== "RECEPCAO") redirect("/");
  return <FinanceiroTela dono={s.papel === "DONO"} />;
}
