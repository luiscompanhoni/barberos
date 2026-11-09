import { redirect } from "next/navigation";
import { FinanceiroTela, type Aba } from "@/components/financeiro/FinanceiroTela";
import { FinanceiroContexto } from "@/components/financeiro/FinanceiroContexto";
import { MeuFinanceiro } from "@/components/financeiro/MeuFinanceiro";
import { pode } from "@/lib/auth/permissoes";
import { BALCAO, GESTAO, exigirSessao } from "@/lib/auth/sessao";
import { contarPendentes } from "@/lib/estornos/servico";

export const dynamic = "force-dynamic";

const ABAS: Aba[] = ["caixa", "despesas", "links", "estornos", "conciliacao", "resumo", "resultado", "historico", "indicadores"];

/** Caixa, despesas, links, estornos e conciliacao (dono, gerente e recepcao); resumo e resultado do mes com a permissao "lucro". */
export default async function Financeiro({ searchParams }: PageProps<"/financeiro">) {
  const s = await exigirSessao();
  const { aba, area } = await searchParams;
  const podeEmpresa = BALCAO.includes(s.papel);
  if (!podeEmpresa && area !== "pessoal") redirect("/financeiro?area=pessoal");
  // Nunca carrega valores, permissões ou pendências da empresa no contexto pessoal.
  if (area === "pessoal") return <FinanceiroContexto pessoal podeEmpresa={podeEmpresa}><MeuFinanceiro /></FinanceiroContexto>;
  if (aba === "caixa") redirect("/caixa");
  const verLucro = await pode(s, "lucro");
  const verIndicadores = await pode(s, "resultado");
  return (
    <FinanceiroContexto pessoal={false} podeEmpresa>
      <FinanceiroTela key={typeof aba === "string" ? aba : "inicio"} verLucro={verLucro} verIndicadores={verIndicadores} gestao={GESTAO.includes(s.papel)} dono={s.papel === "DONO"} estornosPendentes={await contarPendentes()}
        abaInicial={ABAS.find((a) => a === aba && (a !== "indicadores" || verIndicadores) && (a !== "historico" || s.papel === "DONO") && (!["resumo", "resultado"].includes(a) || verLucro)) ?? (verIndicadores ? "indicadores" : verLucro ? "resultado" : "despesas")} />
    </FinanceiroContexto>
  );
}
