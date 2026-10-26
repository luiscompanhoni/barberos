import { NextResponse } from "next/server";
import { dataLocal } from "@/lib/agenda/tempo";
import { resultadoDoMes } from "@/lib/conciliacao/resultado";
import { pode } from "@/lib/auth/permissoes";
import { BALCAO, exigirSessao } from "@/lib/auth/sessao";
import { alertaBackup } from "@/lib/backups";
import { produtosAcabando, vendasDeHoje } from "@/lib/comandas/relatorio";
import { esperasAtivas } from "@/lib/crescimento/espera";
import { rota } from "@/lib/erros";
import { contarPendentes } from "@/lib/estornos/servico";
import { mapaDePico, pendencias, resumoDoDia, resumoDoMes } from "@/lib/painel";

export const GET = rota(async () => {
  const s = await exigirSessao(BALCAO);
  const [verResultado, verLucro] = await Promise.all([pode(s, "resultado"), pode(s, "lucro")]);
  const [dia, pend, mes, pico, vendas, acabando, esperas, estornos, backup] = await Promise.all([
    resumoDoDia(),
    pendencias(),
    // Faturamento e mapa de pico: so quem pode ver o resultado.
    verResultado ? resumoDoMes() : null,
    verResultado ? mapaDePico() : null,
    vendasDeHoje(),
    produtosAcabando(),
    esperasAtivas(),
    contarPendentes(),
    // Backup atrasado ou com erro: so o dono ve.
    s.papel === "DONO" ? alertaBackup() : null,
  ]);
  // A mesma fonte do financeiro; uma falha aqui não tira a agenda e as pendências do ar.
  const financeiro = verLucro
    ? await resultadoDoMes(dataLocal(Date.now(), pend.fuso).slice(0, 7))
      .then((r) => ({ mes: r.mes, faturamento: r.registrado.total, despesas: r.despesas.total,
        taxas: r.custos.total, lucro: r.lucro, alertas: r.alertas }))
      .catch((e) => { console.error("[painel] resultado do mes", e); return null; })
    : null;
  return NextResponse.json({ financeiro, dia, pendencias: { ...pend, estornosPendentes: estornos, produtosAcabando: acabando, esperas: esperas.map((e) => ({ id: e.id, data: e.data.toISOString().slice(0, 10), periodo: e.periodo, cliente: e.cliente.nome })) }, mes, pico, vendas, backup });
});
