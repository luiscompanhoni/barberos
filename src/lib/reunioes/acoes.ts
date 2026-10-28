import { somarDias } from "@/lib/agenda/tempo";
import { db } from "@/lib/db";
import type { AcaoReuniao } from "./tipos";

/** A atribuicao explicita e a autorizacao de compartilhar a acao com o profissional. */
export async function acoesDoBarbeiro(barbeiroId: string, hoje: string) {
  const rs = await db.reuniao.findMany({ where: { fim: { gte: somarDias(hoje, -90) } }, orderBy: { criadoEm: "desc" }, take: 100, select: { id: true, acoes: true } });
  return rs.flatMap((r) => (r.acoes as unknown as AcaoReuniao[]).filter((a) => a.barbeiroId === barbeiroId && !a.concluida).map((a) => ({ ...a, reuniaoId: r.id })));
}
