import { NextResponse } from "next/server";
import { configuracao } from "@/lib/agenda/carregar";
import { exigirCliente } from "@/lib/auth/sessao";
import { painelDeIndicacao } from "@/lib/crescimento/indicacao";
import { extratoDoCliente, indicadosDoCliente, resumoSaldoDoCliente } from "@/lib/crescimento/saldo";
import { rota } from "@/lib/erros";

/** Tela "Saldo" do cliente: saldo, extrato (cashback, indicacao) e amigos indicados. */
export const GET = rota(async () => {
  const s = await exigirCliente();
  const [cfg, extrato, indicados, indicacao, resumo] = await Promise.all([
    configuracao(),
    extratoDoCliente(s.clienteId),
    indicadosDoCliente(s.clienteId),
    painelDeIndicacao(s.clienteId),
    resumoSaldoDoCliente(s.clienteId),
  ]);
  return NextResponse.json({
    ...resumo,
    cashback: { ativo: cfg.cashbackAtivo, pct: cfg.cashbackPct, validadeDias: cfg.cashbackValidadeDias },
    indicacao,
    indicados,
    extrato,
  });
});
