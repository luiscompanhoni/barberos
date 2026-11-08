import { NextResponse } from "next/server";
import { z } from "zod";
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal } from "@/lib/agenda/tempo";
import { exigirSessaoCom, pode } from "@/lib/auth/permissoes";
import { rota } from "@/lib/erros";
import { relatorioComissoes } from "@/lib/rh/comissoes";
import { intervaloCompetencia } from "@/lib/rh/regras";
import { parametros, zData, zId } from "@/lib/validacao";

export const dynamic = "force-dynamic";

/** Comissao por barbeiro no periodo (padrao: mes atual). */
export const GET = rota(async (req: Request) => {
  const s = await exigirSessaoCom("comissao", "folha");
  const q = parametros(req, z.object({ inicio: zData.optional(), fim: zData.optional(), barbeiroId: zId.optional() }));
  const mes = intervaloCompetencia(dataLocal(Date.now(), (await configuracao()).fuso).slice(0, 7));
  const [dados, verFolha] = await Promise.all([relatorioComissoes(q.inicio ?? mes.inicio, q.fim ?? mes.fim, q.barbeiroId), pode(s, "folha")]);
  return NextResponse.json({ ...dados, incluiFolha: verFolha, barbeiros: dados.barbeiros.map(b => ({ ...b, folha: verFolha ? b.folha : null })) });
});
