/**
 * Saldo do cliente: cashback + premios de indicacao + boas-vindas. Cada credito e um "beneficio";
 * o saldo e a soma dos disponiveis que ainda nao venceram. Usado na comanda como desconto.
 */
import { auditar } from "@/lib/auditoria";
import { exigirPermissao } from "@/lib/auth/permissoes";
import type { Sessao } from "@/lib/auth/sessao";
import { resumoComanda } from "@/lib/comandas/regras";
import { avisarComanda } from "@/lib/comandas/servico";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";

/** Filtro dos creditos que contam no saldo agora. */
export const disponiveis = (agora = new Date()) => ({ status: "DISPONIVEL" as const, OR: [{ expiraEm: null }, { expiraEm: { gt: agora } }] });

/** Ordem de uso: primeiro o que vence antes (sem validade por ultimo). */
export function ordemDeUso<T extends { expiraEm: Date | null; criadoEm: Date }>(xs: T[]) {
  return [...xs].sort((a, b) => (a.expiraEm?.getTime() ?? Infinity) - (b.expiraEm?.getTime() ?? Infinity) || a.criadoEm.getTime() - b.criadoEm.getTime());
}

/**
 * Quanto de cada credito sai para cobrir `valor` (o ultimo pode ser parcial).
 * Devolve [{id, usa, sobra}] na ordem de uso.
 */
export function planoDeUso(creditos: { id: string; valorCentavos: number }[], valor: number) {
  const out: { id: string; usa: number; sobra: number }[] = [];
  let falta = valor;
  for (const c of creditos) {
    if (falta <= 0) break;
    const usa = Math.min(c.valorCentavos, falta);
    out.push({ id: c.id, usa, sobra: c.valorCentavos - usa });
    falta -= usa;
  }
  return out;
}

export async function saldoDoCliente(clienteId: string) {
  const r = await db.beneficio.aggregate({ where: { clienteId, ...disponiveis() }, _sum: { valorCentavos: true } });
  return r._sum.valorCentavos ?? 0;
}

/** Usa o saldo do cliente na comanda aberta (vira desconto, ate o valor que ainda tem para descontar). */
export async function usarSaldo(s: Sessao, comandaId: string) {
  await exigirPermissao(s, "saldo");
  const r = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM comandas WHERE id = ${comandaId} FOR UPDATE`;
    const c = await tx.comanda.findUnique({ where: { id: comandaId }, include: { itens: true, pagamentos: true } });
    if (!c) throw naoEncontrado("Comanda");
    if (c.status !== "ABERTA") throw new ErroNegocio("Essa comanda já foi fechada.");
    if (!c.clienteId) throw new ErroNegocio("Comanda sem cliente cadastrado: não há saldo para usar.");
    const { subtotal } = resumoComanda(c.itens, c.pagamentos, 0);
    const podeDescontar = subtotal - c.descontoCentavos;
    if (podeDescontar <= 0) throw new ErroNegocio("A comanda não tem valor para descontar.");
    const creditos = ordemDeUso(await tx.beneficio.findMany({ where: { clienteId: c.clienteId, ...disponiveis() } }));
    if (!creditos.length) throw new ErroNegocio("O cliente não tem saldo.");

    const plano = planoDeUso(creditos, podeDescontar);
    const agora = new Date();
    for (const p of plano) {
      const b = creditos.find((x) => x.id === p.id)!;
      if (p.sobra > 0) {
        // Usado em parte: a parte usada vira um registro ligado ao credito de origem, que fica com o que sobrou
        // (assim continua ligado a indicacao/comanda que o gerou).
        await tx.beneficio.create({
          data: {
            clienteId: b.clienteId, descricao: b.descricao, valorCentavos: p.usa, motivo: b.motivo, expiraEm: b.expiraEm,
            status: "USADO", usadoEm: agora, comandaId, origemBeneficioId: b.origemBeneficioId ?? b.id,
          },
        });
        await tx.beneficio.update({ where: { id: b.id }, data: { valorCentavos: p.sobra } });
      } else {
        await tx.beneficio.update({ where: { id: b.id }, data: { status: "USADO", usadoEm: agora, comandaId } });
      }
    }
    const usado = plano.reduce((t, p) => t + p.usa, 0);
    await tx.comanda.update({ where: { id: comandaId }, data: { descontoCentavos: c.descontoCentavos + usado } });
    await auditar(tx, s.usuarioId, "usar_saldo", "comanda", comandaId, { valorCentavos: usado });
    return { usadoCentavos: usado };
  });
  avisarComanda(comandaId);
  return r;
}

const ORIGEM: Record<string, string> = { CASHBACK: "Cashback", INDICOU: "Indicação", INDICADO: "Boas-vindas", MANUAL: "Crédito", ROLETA: "Roleta", JOGO: "Jogos" };

/** Extrato do cliente: cada credito com origem, situacao e onde foi usado. */
export async function extratoDoCliente(clienteId: string) {
  const agora = new Date();
  const bs = await db.beneficio.findMany({ where: { clienteId }, orderBy: { criadoEm: "desc" }, take: 60 });
  const comandas = await db.comanda.findMany({
    where: { id: { in: bs.flatMap((b) => [b.comandaId, b.comandaOrigemId]).filter((x): x is string => !!x) } },
    select: { id: true, numero: true },
  });
  const numero = (id: string | null) => (id ? comandas.find((c) => c.id === id)?.numero ?? null : null);
  return bs.map((b) => ({
    id: b.id,
    origem: ORIGEM[b.motivo] ?? b.motivo,
    descricao: b.descricao,
    valorCentavos: b.valorCentavos,
    situacao: b.status === "USADO" ? "usado" : b.status === "CANCELADO" ? "cancelado" : b.expiraEm && b.expiraEm <= agora ? "vencido" : "disponivel",
    criadoEm: b.criadoEm,
    usadoEm: b.usadoEm,
    expiraEm: b.expiraEm,
    usadoNaComanda: numero(b.comandaId),
    geradoNaComanda: numero(b.comandaOrigemId),
  }));
}

/** Amigos que o cliente indicou: quem ja veio e quanto ele ganhou com cada um. */
export async function indicadosDoCliente(clienteId: string) {
  const inds = await db.indicacao.findMany({
    where: { indicadorId: clienteId },
    orderBy: { criadoEm: "desc" },
    include: { indicado: { select: { nome: true } }, beneficios: { where: { motivo: "INDICOU" }, select: { id: true, valorCentavos: true } } },
  });
  // O premio pode ter sido usado em partes: soma o credito de origem e as partes ligadas a ele.
  const premioIds = inds.flatMap((i) => i.beneficios.map((b) => b.id));
  const partes = premioIds.length
    ? await db.beneficio.findMany({ where: { origemBeneficioId: { in: premioIds } }, select: { origemBeneficioId: true, valorCentavos: true } })
    : [];
  return inds.map((i) => {
    const ids = new Set(i.beneficios.map((b) => b.id));
    return {
      id: i.id,
      nome: i.indicado.nome.trim().split(/\s+/)[0] || "Amigo",
      desde: i.criadoEm,
      veio: !!i.convertidaEm,
      ganhouCentavos:
        i.beneficios.reduce((t, b) => t + b.valorCentavos, 0) +
        partes.filter((p) => ids.has(p.origemBeneficioId!)).reduce((t, p) => t + p.valorCentavos, 0),
    };
  });
}
