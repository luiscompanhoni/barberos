import { redirect } from "next/navigation";
import { FinanceiroTela, type Aba } from "@/components/financeiro/FinanceiroTela";
import { pode } from "@/lib/auth/permissoes";
import { BALCAO, GESTAO, sessaoAtual } from "@/lib/auth/sessao";
import { contarPendentes } from "@/lib/estornos/servico";

export const dynamic = "force-dynamic";

const ABAS: Aba[] = ["caixa", "despesas", "links", "estornos", "conciliacao", "resumo", "resultado"];

/** Caixa, despesas, links, estornos e conciliacao (dono, gerente e recepcao); resumo do mes com a permissao "resultado". */
export default async function Financeiro({ searchParams }: PageProps<"/financeiro">) {
  const s = (await sessaoAtual())!;
  if (!BALCAO.includes(s.papel)) redirect("/");
  const { aba } = await searchParams;
  const verResultado = await pode(s, "resultado");
  return (
    <FinanceiroTela verResultado={verResultado} gestao={GESTAO.includes(s.papel)} estornosPendentes={await contarPendentes()}
      abaInicial={ABAS.find((a) => a === aba && (!["resumo", "resultado"].includes(a) || verResultado)) ?? "caixa"} />
  );
}
