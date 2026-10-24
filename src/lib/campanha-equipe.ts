import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { ciclosDaCampanha } from "./equipe-regras";

/** Apenas produtos atribuídos ao vendedor em comandas fechadas e efetivamente pagas. */
export async function vendasDaCampanha(tx: Prisma.TransactionClient, c: { inicio: Date; fim: Date; metaQuantidade: number; metaCentavos: number }, barbeiroId: string) {
  const comandas = await tx.comanda.findMany({ where: { status: "FECHADA", fechadaEm: { gte: c.inicio, lte: c.fim }, itens: { some: { barbeiroId, produtoId: { not: null } } } }, include: { itens: true, pagamentos: true } });
  let quantidade = 0, receita = 0;
  for (const comanda of comandas) {
    const bruto = comanda.itens.reduce((s, i) => s + i.quantidade * i.precoUnitCentavos, 0);
    const liquido = Math.max(0, bruto - comanda.descontoCentavos);
    const pago = comanda.pagamentos.filter(p => p.status === "PAGO").reduce((s, p) => s + p.valorCentavos - p.estornadoCentavos, 0);
    if (bruto <= 0 || liquido <= 0 || pago < liquido || comanda.pagamentos.some(p => p.estornadoCentavos > 0)) continue;
    for (const i of comanda.itens.filter(i => i.barbeiroId === barbeiroId && i.produtoId && i.precoUnitCentavos > 0)) {
      quantidade += i.quantidade;
      receita += Math.floor(i.quantidade * i.precoUnitCentavos * liquido / bruto);
    }
  }
  return { quantidade, receita, ciclos: ciclosDaCampanha(quantidade, receita, c.metaQuantidade, c.metaCentavos) };
}

export async function painelCampanhas(barbeiroId: string | null, gestao: boolean) {
  const cs = await db.campanhaEquipe.findMany({ orderBy: { criadoEm: "desc" }, take: 50 });
  const nomes = new Map((gestao ? await db.barbeiro.findMany({ select: { id:true, nome:true } }) : []).map(b => [b.id,b.nome]));
  return Promise.all(cs.map(async c => {
    const vendas = barbeiroId ? await vendasDaCampanha(db, c, barbeiroId) : null;
    const bonus = await db.bonusEquipe.findMany({ where: { campanhaId: c.id, ...(!gestao ? { barbeiroId: barbeiroId ?? "sem-acesso" } : {}) }, orderBy: { criadoEm: "desc" } });
    return { ...c, vendas, rodadasDisponiveis: Math.max(0, (vendas?.ciclos ?? 0) - bonus.filter(b => b.barbeiroId === barbeiroId).length), bonus: bonus.map(b => ({...b, nomeBarbeiro:nomes.get(b.barbeiroId) ?? null})) };
  }));
}
