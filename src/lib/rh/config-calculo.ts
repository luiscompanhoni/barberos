import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { regrasExtras } from "./pote";
import { lerVigenciaRemuneracao } from "./vigencias";
import { regrasExtrasVigentes, regrasServicoVigentes } from "./vigencia-regras";

/** Consumidores operacionais usam a competência do atendimento, nunca o último rascunho futuro. */
export async function regrasServicosNaCompetencia(competencia: string, c: Prisma.TransactionClient = db) {
  const versao = await lerVigenciaRemuneracao(c, "servicos", competencia);
  return regrasServicoVigentes(versao?.conteudo ?? await c.comissaoServico.findMany({ orderBy: { id: "asc" } }));
}
export async function extrasNaCompetencia(competencia: string, c: Prisma.TransactionClient = db) {
  const versao = await lerVigenciaRemuneracao(c, "extras", competencia);
  return regrasExtrasVigentes(versao?.conteudo ?? await regrasExtras(c));
}
