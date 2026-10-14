import { NextResponse } from "next/server";
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
  const verResultado = await pode(s, "resultado");
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
  return NextResponse.json({ dia, pendencias: { ...pend, estornosPendentes: estornos, produtosAcabando: acabando, esperas: esperas.map((e) => ({ id: e.id, data: e.data.toISOString().slice(0, 10), periodo: e.periodo, cliente: e.cliente.nome })) }, mes, pico, vendas, backup });
});
