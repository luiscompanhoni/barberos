import { NextResponse } from "next/server";
import { exigirCliente } from "@/lib/auth/sessao";
import { configuracao } from "@/lib/agenda/carregar";
import { rota } from "@/lib/erros";
import { configRecompras } from "@/lib/recompras/configuracao";
import { ciclosDoCliente } from "@/lib/recompras/rotina";
export const GET = rota(async () => {
  const s = await exigirCliente();
  const [cfg, politica] = await Promise.all([configuracao(), configRecompras()]);
  return NextResponse.json(politica.ativo ? await ciclosDoCliente(s.clienteId, Date.now(), cfg.fuso) : []);
});
