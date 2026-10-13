import { NextResponse } from "next/server";
import { configuracao } from "@/lib/agenda/carregar";
import { exigirCliente } from "@/lib/auth/sessao";
import { painelDeIndicacao } from "@/lib/crescimento/indicacao";
import { extratoDoCliente, indicadosDoCliente } from "@/lib/crescimento/saldo";
import { rota } from "@/lib/erros";

/** Tela "Saldo" do cliente: saldo, extrato (cashback, indicacao) e amigos indicados. */
export const GET = rota(async () => {
  const s = await exigirCliente();
  const [cfg, extrato, indicados, indicacao] = await Promise.all([
    configuracao(),
    extratoDoCliente(s.clienteId),
    indicadosDoCliente(s.clienteId),
    painelDeIndicacao(s.clienteId),
  ]);
  const disponiveis = extrato.filter((e) => e.situacao === "disponivel");
  const em30dias = Date.now() + 30 * 86_400_000;
  const vencendo = disponiveis.filter((e) => e.expiraEm && +e.expiraEm < em30dias);
  return NextResponse.json({
    saldoCentavos: disponiveis.reduce((t, e) => t + e.valorCentavos, 0),
    vencendo: vencendo.length ? { valorCentavos: vencendo.reduce((t, e) => t + e.valorCentavos, 0), data: vencendo.map((e) => e.expiraEm!).sort()[0] } : null,
    ganhoTotalCentavos: extrato.filter((e) => e.situacao !== "cancelado").reduce((t, e) => t + e.valorCentavos, 0),
    cashback: { ativo: cfg.cashbackAtivo, pct: cfg.cashbackPct, validadeDias: cfg.cashbackValidadeDias },
    indicacao,
    indicados,
    extrato,
  });
});
