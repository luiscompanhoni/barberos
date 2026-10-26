import { redirect } from "next/navigation";
import { FinanceiroTela, type Aba } from "@/components/financeiro/FinanceiroTela";
import { pode } from "@/lib/auth/permissoes";
import { BALCAO, GESTAO, sessaoAtual } from "@/lib/auth/sessao";
import { contarPendentes } from "@/lib/estornos/servico";

export const dynamic = "force-dynamic";

const ABAS: Aba[] = ["caixa", "despesas", "links", "estornos", "conciliacao", "resumo", "resultado"];

/** Caixa, despesas, links, estornos e conciliacao (dono, gerente e recepcao); resumo e resultado do mes com a permissao "lucro". */
export default async function Financeiro({ searchParams }: PageProps<"/financeiro">) {
  const s = (await sessaoAtual())!;
  if (!BALCAO.includes(s.papel)) redirect("/");
  const { aba } = await searchParams;
  if (aba === "caixa") redirect("/caixa");
  const verLucro = await pode(s, "lucro");
  return (
    <FinanceiroTela verLucro={verLucro} gestao={GESTAO.includes(s.papel)} estornosPendentes={await contarPendentes()}
      abaInicial={ABAS.find((a) => a === aba && (!["resumo", "resultado"].includes(a) || verLucro)) ?? (verLucro ? "resultado" : "despesas")} />
  );
}
