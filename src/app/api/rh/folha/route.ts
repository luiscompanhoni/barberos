import { NextResponse } from "next/server";
import { z } from "zod";
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal } from "@/lib/agenda/tempo";
import { exigirSessaoCom } from "@/lib/auth/permissoes";
import { rota } from "@/lib/erros";
import { FORMAS_PAGAMENTO, fecharFolha, pagarFolha, previaFolha, reabrirFolha } from "@/lib/rh/folha";
import { corpo, parametros, zId } from "@/lib/validacao";

export const dynamic = "force-dynamic";
const zComp = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Competência no formato AAAA-MM");

/** Folha da competencia (padrao: mes atual). So o dono. */
export const GET = rota(async (req: Request) => {
  await exigirSessaoCom("folha");
  const q = parametros(req, z.object({ competencia: zComp.optional() }));
  return NextResponse.json(await previaFolha(q.competencia ?? dataLocal(Date.now(), (await configuracao()).fuso).slice(0, 7)));
});

/** Fechar a folha do mes, marcar como paga ou reabrir (por funcionario). */
export const POST = rota(async (req: Request) => {
  const s = await exigirSessaoCom("folha");
  const b = await corpo(req, z.discriminatedUnion("acao", [
    z.object({ acao: z.literal("fechar"), competencia: zComp, pessoaId: zId.optional() }),
    z.object({ acao: z.literal("pagar"), competencia: zComp, pessoaId: zId, forma: z.enum(FORMAS_PAGAMENTO).default("PIX") }),
    z.object({ acao: z.literal("reabrir"), competencia: zComp, pessoaId: zId }),
  ]));
  if (b.acao === "fechar") await fecharFolha(s, b.competencia, b.pessoaId);
  else if (b.acao === "pagar") await pagarFolha(s, b.competencia, b.pessoaId, b.forma);
  else await reabrirFolha(s, b.competencia, b.pessoaId);
  return NextResponse.json(await previaFolha(b.competencia));
});
