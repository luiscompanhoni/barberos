import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessaoCom } from "@/lib/auth/permissoes";
import { auditar } from "@/lib/auditoria";
import { sincronizarHistorico, sincronizarRecentes } from "@/lib/conciliacao/celcash";
import { db } from "@/lib/db";
import { rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";

export const maxDuration = 300;

/** Traz o extrato da Celcash agora: so os ultimos dias ou o historico inteiro (ja guardado nao duplica). */
export const POST = rota(async (req: Request) => {
  const s = await exigirSessaoCom("lucro");
  const b = await corpo(req, z.object({ historico: z.boolean().default(false) }));
  const novos = b.historico ? await sincronizarHistorico() : await sincronizarRecentes(Date.now(), true);
  await db.$transaction((tx) => auditar(tx, s.usuarioId, "conciliacao_sincronizar", "configuracao", "celcash", { historico: b.historico, novos }));
  return NextResponse.json({ novos });
});
