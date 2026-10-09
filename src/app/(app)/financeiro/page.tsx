import { redirect } from "next/navigation";
import { FinanceiroTela, type Aba } from "@/components/financeiro/FinanceiroTela";
import { sessaoAtual } from "@/lib/auth/sessao";
import { contarPendentes } from "@/lib/estornos/servico";

export const dynamic = "force-dynamic";

const ABAS: Aba[] = ["caixa", "despesas", "links", "estornos", "conciliacao", "resumo"];

/** Caixa, despesas, links, estornos e conciliacao (dono e gerente/recepcao); resumo do mes so o dono. */
export default async function Financeiro({ searchParams }: PageProps<"/financeiro">) {
  const s = (await sessaoAtual())!;
  if (s.papel !== "DONO" && s.papel !== "RECEPCAO") redirect("/");
  const { aba } = await searchParams;
  return <FinanceiroTela dono={s.papel === "DONO"} abaInicial={ABAS.find((a) => a === aba && (a !== "resumo" || s.papel === "DONO")) ?? "caixa"} estornosPendentes={await contarPendentes()} />;
}
