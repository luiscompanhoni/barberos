import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirGestaoBarbeiro, exigirSessao } from "@/lib/auth/sessao";
import { pode } from "@/lib/auth/permissoes";
import { rota } from "@/lib/erros";
import { corpo, parametros, zData, zId } from "@/lib/validacao";
import { oportunidadesDoDia } from "@/lib/recompras/servico";
import { registrarOferta } from "@/lib/recompras/ofertas";
import { schemaOferta } from "@/lib/recompras/schemas";
import { parseData } from "@/lib/agenda/tempo";

export const GET = rota(async (req: Request) => {
  const s = await exigirSessao();
  const q = parametros(req, z.object({ data: zData.refine(d => { try { parseData(d); return true; } catch { return false; } }, "Data inválida"), barbeiroId: zId }));
  exigirGestaoBarbeiro(s, q.barbeiroId);
  const oportunidades = await oportunidadesDoDia(q.barbeiroId, q.data);
  const verComissao = s.barbeiroId === q.barbeiroId || await pode(s, "comissoes_equipe");
  return NextResponse.json(oportunidades.map(o => ({ ...o, comissaoCentavos: verComissao ? o.comissaoCentavos : null })));
});
export const POST = rota(async (req: Request) => {
  const s = await exigirSessao();
  return NextResponse.json(await registrarOferta(s, await corpo(req, schemaOferta)));
});
