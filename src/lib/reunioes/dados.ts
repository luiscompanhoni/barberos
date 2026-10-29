import { configuracao } from "@/lib/agenda/carregar";
import { instanteLocal, somarDias } from "@/lib/agenda/tempo";
import { resumoComanda } from "@/lib/comandas/regras";
import { db } from "@/lib/db";
import { mensalidadesEstornadas } from "@/lib/estornos/financeiro";
import { STATUS_EFETIVOS } from "@/lib/estornos/regras";
import { ocupacaoDosDias } from "@/lib/indicadores/ocupacao";
import { relatorioComissoes } from "@/lib/rh/comissoes";
import { ratearCentavos } from "./regras";
import type { GrupoReuniao, IndicadoresReuniao } from "./tipos";

// vendasFora/comissaoFora: o que não tem par no período (venda sem atendimento concluído nele, ou atendimento sem venda).
type Grupo = GrupoReuniao & { custo: number; comissaoPendente: boolean; vendasForaCentavos: number; comissaoForaCentavos: number };
const novo = (id: string, nome: string): Grupo => ({ id, nome, atendimentos: 0, avulsos: 0, assinantes: 0, vendasCentavos: 0, receitaAssinaturasCentavos: 0, comissaoCentavos: 0, margemCentavos: null, custosPendentes: 0, faltas: 0, cancelamentos: 0, custo: 0, comissaoPendente: false, vendasForaCentavos: 0, comissaoForaCentavos: 0 });
const linha = (m: Map<string, Grupo>, id: string, nome: string) => {
  if (!m.has(id)) m.set(id, novo(id, nome));
  return m.get(id)!;
};
/** A margem só junta venda e produção do mesmo período; o que ficou sem par não entra nela (fica nos avisos). */
function finalizar(g: Grupo): GrupoReuniao {
  const { custo, comissaoPendente, vendasForaCentavos, comissaoForaCentavos, ...r } = g;
  return { ...r, comissaoCentavos: comissaoPendente ? null : r.comissaoCentavos,
    margemCentavos: r.custosPendentes || comissaoPendente ? null
      : r.vendasCentavos - vendasForaCentavos + r.receitaAssinaturasCentavos - custo - ((r.comissaoCentavos ?? 0) - comissaoForaCentavos) };
}

/** Vendas: fechamento da comanda; producao/comissoes: dia do atendimento; mensalidades: pagamento. */
export async function dadosDoPeriodo(inicio: string, fim: string) {
  const cfg = await configuracao();
  const janela = { gte: new Date(instanteLocal(inicio, 0, cfg.fuso)), lt: new Date(instanteLocal(somarDias(fim, 1), 0, cfg.fuso)) };
  const dias: string[] = [];
  for (let d = inicio; d <= fim; d = somarDias(d, 1)) dias.push(d);
  const estornadas = await mensalidadesEstornadas();
  const [ags, comandas, recebidas, estornos, ocupacao, comissoes, regrasPote] = await Promise.all([
    db.agendamento.findMany({ where: { inicio: janela }, select: { id: true, clienteId: true, barbeiroId: true, servicoId: true, cadeiraId: true,
      status: true, assinaturaId: true, precoCentavos: true, inicio: true, barbeiro: { select: { nome: true } }, cadeira: { select: { nome: true } },
      servico: { select: { nome: true, custoCentavos: true } }, itemComanda: { select: { comanda: { select: { status: true, fechadaEm: true } } } } } }),
    db.comanda.findMany({ where: { status: "FECHADA", fechadaEm: janela }, include: { pagamentos: true,
      itens: { include: { produto: { select: { custoCentavos: true, categoria: true } },
        agendamento: { select: { id: true, inicio: true, barbeiroId: true, cadeiraId: true, servicoId: true, assinaturaId: true, cadeira: { select: { nome: true } }, servico: { select: { nome: true } }, barbeiro: { select: { nome: true } } } } } } } }),
    db.cobranca.aggregate({ where: { OR: [{ status: "PAGA" }, { status: "ESTORNADA", id: { in: estornadas } }], pagaEm: janela }, _sum: { valorCentavos: true } }),
    db.pedidoEstorno.findMany({ where: { status: { in: STATUS_EFETIVOS }, executadoEm: janela }, select: { tipo: true, valorCentavos: true } }),
    ocupacaoDosDias(dias), relatorioComissoes(inicio, fim), db.poteFicha.findMany(),
  ]);
  const feitos = ags.filter((a) => a.status === "CONCLUIDO");
  const feitosIds = new Set(feitos.map((a) => a.id));
  const clientes = [...new Set(feitos.map((a) => a.clienteId))];
  const anteriores = await db.agendamento.findMany({ where: { clienteId: { in: clientes }, status: "CONCLUIDO", inicio: { lt: janela.gte } }, distinct: ["clienteId"], select: { clienteId: true } });
  const bs = new Map<string, Grupo>(), ss = new Map<string, Grupo>(), cs = new Map<string, Grupo>();
  const total = novo("total", "Barbearia");
  const comPorAg = new Map(comissoes.barbeiros.flatMap((b) => b.atendimentos.map((a) => [a.id, a] as const)));
  const vendidoNoPeriodo = (c: { status: string; fechadaEm: Date | null } | undefined) => c?.status === "FECHADA" && !!c.fechadaEm && c.fechadaEm >= janela.gte && c.fechadaEm < janela.lt;
  let semFechamento = 0;
  for (const a of ags) {
    const semVenda = a.status === "CONCLUIDO" && !a.assinaturaId && !vendidoNoPeriodo(a.itemComanda?.comanda);
    if (semVenda) semFechamento++;
    const grupos = [total, linha(bs, a.barbeiroId, a.barbeiro.nome), linha(ss, a.servicoId, a.servico.nome), linha(cs, a.cadeiraId ?? "sem-cadeira", a.cadeira?.nome ?? "Cadeira não informada")];
    for (const g of grupos) {
      if (a.status === "FALTOU") g.faltas++;
      if (a.status === "CANCELADO") g.cancelamentos++;
      if (a.status !== "CONCLUIDO") continue;
      g.atendimentos++;
      if (a.assinaturaId) g.assinantes++; else g.avulsos++;
      const com = comPorAg.get(a.id);
      if (!com || com.regra === "Sem regra") g.comissaoPendente = true;
      g.comissaoCentavos! += com?.comissao ?? 0;
      // Ainda sem venda no período: comissão aparece, mas custo e comissão desse atendimento ficam fora da margem.
      if (semVenda) g.comissaoForaCentavos += com?.comissao ?? 0;
      else if (a.servico.custoCentavos === null) g.custosPendentes++; else g.custo += a.servico.custoCentavos;
    }
  }
  let datasDiferentes = false;
  for (const c of comandas) {
    const r = resumoComanda(c.itens, c.pagamentos, c.descontoCentavos);
    const valores = ratearCentavos(Math.max(0, r.total - r.estornado), c.itens.map((i) => i.quantidade * i.precoUnitCentavos));
    c.itens.forEach((i, ix) => {
      const a = i.agendamento;
      const barbeiroId = a?.barbeiroId ?? i.barbeiroId;
      const nome = a?.barbeiro.nome ?? comissoes.barbeiros.find((b) => b.barbeiroId === barbeiroId)?.nome ?? "Sem profissional";
      const grupos = [total, linha(bs, barbeiroId ?? "sem-profissional", nome),
        linha(ss, a?.servicoId ?? (i.produtoId ? `produto:${i.produtoId}` : "outros"), a?.servico.nome ?? i.descricao),
        linha(cs, a?.cadeiraId ?? "sem-cadeira", a?.cadeira?.nome ?? "Cadeira não informada")];
      const semProducao = !!a && !feitosIds.has(a.id);
      if (semProducao) datasDiferentes = true;
      for (const g of grupos) {
        g.vendasCentavos += valores[ix];
        if (semProducao) g.vendasForaCentavos += valores[ix];
        if (!a) {
          if (i.produto) g.custo += i.produto.custoCentavos * i.quantidade;
          else g.custosPendentes++;
        }
      }
    });
  }
  const fichas = new Map(regrasPote.map((f) => [f.servicoId, f.fichas]));
  for (const b of comissoes.barbeiros) {
    const g = linha(bs, b.barbeiroId, b.nome);
    if (b.semRegra) { g.comissaoPendente = true; total.comissaoPendente = true; }
    const extras = (b.assinaturas?.comissao ?? 0) + (b.produtos?.comissao ?? 0);
    g.comissaoCentavos! += extras; total.comissaoCentavos! += extras;
    const atribuida = b.assinaturas?.receitaAtribuida ?? 0;
    g.receitaAssinaturasCentavos += atribuida;
    const atendidos = feitos.filter((a) => a.barbeiroId === b.barbeiroId && a.assinaturaId);
    const pesos = atendidos.map((a) => fichas.get(a.servicoId) ?? 0);
    const receita = ratearCentavos(atribuida, pesos), com = ratearCentavos(b.assinaturas?.comissao ?? 0, pesos);
    atendidos.forEach((a, ix) => {
      for (const grupo of [ss.get(a.servicoId)!, cs.get(a.cadeiraId ?? "sem-cadeira")!]) {
        grupo.receitaAssinaturasCentavos += receita[ix]; grupo.comissaoCentavos! += com[ix];
      }
    });
    // Comissao de produtos por faixa: rateada apenas entre as vendas do profissional.
    if (b.produtos?.comissao) {
      const itens = comandas.flatMap((c) => c.itens.filter((i) => i.produtoId && i.barbeiroId === b.barbeiroId));
      const rateio = ratearCentavos(b.produtos.comissao, itens.map((i) => i.quantidade * i.precoUnitCentavos));
      itens.forEach((i, ix) => { ss.get(`produto:${i.produtoId}`)!.comissaoCentavos! += rateio[ix]; });
      linha(cs, "sem-cadeira", "Cadeira não informada").comissaoCentavos! += b.produtos.comissao;
    }
  }
  const mensalidades = (recebidas._sum.valorCentavos ?? 0) - estornos.filter((e) => e.tipo === "MENSALIDADE").reduce((s, e) => s + e.valorCentavos, 0);
  total.receitaAssinaturasCentavos = mensalidades;
  const grupos = (mapa: Map<string, Grupo>) => [...mapa.values()].map(finalizar).sort((a, b) => b.vendasCentavos + b.receitaAssinaturasCentavos - a.vendasCentavos - a.receitaAssinaturasCentavos);
  const t = finalizar(total);
  const atual: IndicadoresReuniao = { atendimentos: total.atendimentos, avulsos: total.avulsos, assinantes: total.assinantes, clientes: clientes.length,
    faltas: total.faltas, cancelamentos: total.cancelamentos, vendasCentavos: total.vendasCentavos, mensalidadesCentavos: mensalidades,
    faturamentoCentavos: total.vendasCentavos + mensalidades, estornosCentavos: estornos.reduce((s, e) => s + e.valorCentavos, 0),
    ocupacao: ocupacao.total.taxa, capacidadeMin: ocupacao.total.capacidadeMin, ocupadoMin: ocupacao.total.ocupadoMin,
    ticketAvulsoCentavos: null, retornaram: anteriores.length, clientesComHistorico: clientes.length,
    comissaoCentavos: t.comissaoCentavos, margemCentavos: t.margemCentavos, custosPendentes: total.custosPendentes };
  const servicosAvulsos = comissoes.barbeiros.reduce((s, b) => s + b.avulso.base, 0);
  atual.ticketAvulsoCentavos = atual.avulsos ? Math.round(servicosAvulsos / atual.avulsos) : null;
  return { atual, barbeiros: grupos(bs), servicos: grupos(ss), cadeiras: grupos(cs), semFechamento, datasDiferentes };
}
