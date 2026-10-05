import { NextResponse } from "next/server";
import { exigirSessao } from "@/lib/auth/sessao";
import { produtosAcabando, vendasDeHoje } from "@/lib/comandas/relatorio";
import { esperasAtivas } from "@/lib/crescimento/espera";
import { rota } from "@/lib/erros";
import { mapaDePico, pendencias, resumoDoDia, resumoDoMes } from "@/lib/painel";

export const GET = rota(async () => {
  const s = await exigirSessao(["DONO", "RECEPCAO"]);
  const [dia, pend, mes, pico, vendas, acabando, esperas] = await Promise.all([
    resumoDoDia(),
    pendencias(),
    // Faturamento e mapa de pico sao do dono.
    s.papel === "DONO" ? resumoDoMes() : null,
    s.papel === "DONO" ? mapaDePico() : null,
    vendasDeHoje(),
    produtosAcabando(),
    esperasAtivas(),
  ]);
  return NextResponse.json({ dia, pendencias: { ...pend, produtosAcabando: acabando, esperas: esperas.map((e) => ({ id: e.id, data: e.data.toISOString().slice(0, 10), periodo: e.periodo, cliente: e.cliente.nome })) }, mes, pico, vendas });
});
