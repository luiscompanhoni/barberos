import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { dataLocal } from "@/lib/agenda/tempo";
import { ErroNegocio } from "@/lib/erros";
import { ciclosDaCampanha, competenciaDoBonus } from "./equipe-regras";

/**
 * O bonus sorteado entra na folha do vendedor como BONUS: sai no pagamento da folha (despesa FOLHA) e assim
 * desconta do lucro. Folha do mes ja fechada: vai para o mes seguinte.
 */
export async function lancarBonusNaFolha(tx: Prisma.TransactionClient, d: { barbeiroId: string; valorCentavos: number; descricao: string; porId: string; fuso: string }) {
  const pessoa = await tx.checklistPessoa.findUnique({ where: { barbeiroId: d.barbeiroId }, select: { id: true } });
  if (!pessoa) throw new ErroNegocio("Seu cadastro ainda não está ligado à folha de pagamento (RH). Peça à gestão para ligar antes de girar.", 409, "sem_folha");
  const atual = dataLocal(Date.now(), d.fuso).slice(0, 7);
  const fechada = await tx.folhaPagamento.findUnique({ where: { competencia_pessoaId: { competencia: atual, pessoaId: pessoa.id } }, select: { id: true } });
  const competencia = competenciaDoBonus(atual, !!fechada);
  return tx.folhaLancamento.create({ data: { pessoaId: pessoa.id, competencia, tipo: "BONUS", valorCentavos: d.valorCentavos, descricao: d.descricao, porId: d.porId } });
}

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
