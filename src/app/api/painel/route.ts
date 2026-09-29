import { NextResponse } from "next/server";
import { exigirSessao } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { mapaDePico, pendencias, resumoDoDia, resumoDoMes } from "@/lib/painel";

export const GET = rota(async () => {
  const s = await exigirSessao(["DONO", "RECEPCAO"]);
  const [dia, pend, mes, pico] = await Promise.all([
    resumoDoDia(),
    pendencias(),
    // Faturamento e mapa de pico sao do dono.
    s.papel === "DONO" ? resumoDoMes() : null,
    s.papel === "DONO" ? mapaDePico() : null,
  ]);
  return NextResponse.json({ dia, pendencias: pend, mes, pico });
});
