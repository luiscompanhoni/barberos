/**
 * Fichas (direito a uma jogada). Sao criadas sob demanda a partir do que o cliente fez desde que o jogo ligou:
 * atendimento concluido, indicacao que veio, mensalidade paga, aniversario e jogada gratis do periodo.
 * Cada evento libera no maximo uma vez (chave unica no banco), entao sincronizar de novo nunca duplica.
 */
import type { Jogo, Prisma } from "@prisma/client";
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal } from "@/lib/agenda/tempo";
import { db } from "@/lib/db";
import { atendimentoCondicionadoAvaliacao } from "@/lib/avaliacoes/convites";
import { fichasDevidas, gratisDevida } from "./regras";

type Tx = Prisma.TransactionClient;

/** Data a partir da qual o jogo conta eventos (ligou o jogo ou comecou o periodo, o que for mais tarde). */
export function contarDesde(j: Pick<Jogo, "contarDesde" | "inicioEm">) {
  return j.inicioEm && j.inicioEm > j.contarDesde ? j.inicioEm : j.contarDesde;
}

/** Cria as fichas que faltam para o cliente neste jogo. */
export async function sincronizarFichas(tx: Tx, clienteId: string, jogo: Jogo, agora = new Date()) {
  const condicionado = await atendimentoCondicionadoAvaliacao(tx, clienteId, jogo.id, agora);
  const desde = contarDesde(jogo);
  const fuso = (await configuracao(tx)).fuso;
  const precisa = (n: number) => n > 0;
  const [atendimentos, indicacoes, mensalidades, cliente, ultimaGratis] = await Promise.all([
    precisa(jogo.jogadasPorAtendimento)
      ? tx.agendamento.findMany({ where: { clienteId, status: "CONCLUIDO", inicio: { gte: desde },
        ...(condicionado ? { NOT: { OR: [{ id: condicionado }, { adicionalDeId: condicionado }] } } : {}),
      }, select: { id: true, precoCentavos: true, servico: { select: { precoCentavos: true } } } })
      : [],
    precisa(jogo.jogadasPorIndicacao)
      ? tx.indicacao.findMany({ where: { indicadorId: clienteId, convertidaEm: { gte: desde } }, select: { id: true } })
      : [],
    precisa(jogo.jogadasRenovacaoPlano)
      ? tx.cobranca.findMany({ where: { status: "PAGA", pagaEm: { gte: desde }, assinatura: { clienteId } }, select: { id: true } })
      : [],
    precisa(jogo.jogadasAniversario) ? tx.cliente.findUnique({ where: { id: clienteId }, select: { dataNascimento: true } }) : null,
    jogo.gratisACadaDias > 0
      ? tx.fichaJogo.findFirst({ where: { clienteId, jogoId: jogo.id, origem: "GRATIS" }, orderBy: { criadoEm: "desc" }, select: { criadoEm: true } })
      : null,
  ]);

  const devidas = fichasDevidas(jogo, {
    // Atendimento do plano sai a R$ 0: vale o preco do servico para o valor minimo.
    atendimentos: atendimentos.map((a) => ({ id: a.id, valorCentavos: a.precoCentavos || a.servico.precoCentavos })),
    indicacoes: indicacoes.map((i) => i.id),
    mensalidades: mensalidades.map((c) => c.id),
    nascimento: cliente?.dataNascimento ? cliente.dataNascimento.toISOString().slice(0, 10) : null,
    hoje: dataLocal(agora, fuso),
    desde: dataLocal(desde, fuso),
  });
  const gratis = gratisDevida(jogo.gratisACadaDias, ultimaGratis?.criadoEm ?? null, agora.getTime());
  const dados: Prisma.FichaJogoCreateManyInput[] = devidas.map((d) => ({ jogoId: jogo.id, clienteId, origem: d.origem, referencia: d.referencia }));
  if (gratis.devida) dados.push({ jogoId: jogo.id, clienteId, origem: "GRATIS", referencia: dataLocal(agora, fuso) });
  if (dados.length) await tx.fichaJogo.createMany({ data: dados, skipDuplicates: true });
  return { proximaGratisEm: gratis.proximaEm };
}

/** Filtro das fichas que ainda valem. */
export const fichasLivres = (clienteId: string, jogoId: string, agora = new Date()) => ({
  clienteId, jogoId, jogadaId: null, OR: [{ expiraEm: null }, { expiraEm: { gt: agora } }],
});

/** Quantas jogadas o cliente tem em cada jogo (sincroniza antes). */
export async function contarFichas(clienteId: string, jogos: Jogo[]) {
  const proximas = new Map<string, Date | null>();
  await db.$transaction(async (tx) => {
    for (const j of jogos) proximas.set(j.id, (await sincronizarFichas(tx, clienteId, j)).proximaGratisEm);
  });
  const agora = new Date();
  const n = await db.fichaJogo.groupBy({
    by: ["jogoId"],
    where: { clienteId, jogoId: { in: jogos.map((j) => j.id) }, jogadaId: null, OR: [{ expiraEm: null }, { expiraEm: { gt: agora } }] },
    _count: true,
  });
  const qtd = new Map(n.map((x) => [x.jogoId, x._count]));
  return new Map(jogos.map((j) => [j.id, { fichas: qtd.get(j.id) ?? 0, proximaGratisEm: proximas.get(j.id) ?? null }]));
}

/** Textos de "como ganhar mais jogadas" a partir das regras do jogo. */
export function comoGanhar(j: Jogo) {
  const t: string[] = [];
  const vez = (n: number) => (n === 1 ? "1 jogada" : `${n} jogadas`);
  if (j.jogadasPorAtendimento > 0) {
    t.push(j.valorMinimoAtendimentoCentavos > 0
      ? `${vez(j.jogadasPorAtendimento)} por atendimento a partir de R$ ${(j.valorMinimoAtendimentoCentavos / 100).toFixed(0)}`
      : `${vez(j.jogadasPorAtendimento)} por atendimento concluído`);
  }
  if (j.jogadasPorIndicacao > 0) t.push(`${vez(j.jogadasPorIndicacao)} por amigo indicado que vier`);
  if (j.jogadasAniversario > 0) t.push(`${vez(j.jogadasAniversario)} no seu aniversário`);
  if (j.jogadasRenovacaoPlano > 0) t.push(`${vez(j.jogadasRenovacaoPlano)} a cada mensalidade do plano`);
  if (j.gratisACadaDias > 0) t.push(`1 jogada grátis a cada ${j.gratisACadaDias} dias`);
  if (j.soAssinante) t.push("Exclusivo para assinantes");
  return t;
}
