import type { Cenario, GrupoReuniao, IndicadoresReuniao, LeituraReuniao, ProjecaoServico, SnapshotReuniao } from "./tipos";

/** Distribui centavos sem perder dinheiro no arredondamento. Empates usam a ordem dos itens. */
export function ratearCentavos(total: number, pesos: number[]): number[] {
  const soma = pesos.reduce((s, p) => s + Math.max(0, p), 0);
  if (!soma) return pesos.map(() => 0);
  const alvo = Math.max(0, Math.round(total));
  const partes = pesos.map((p, i) => ({ i, valor: Math.floor(alvo * Math.max(0, p) / soma), resto: (alvo * Math.max(0, p)) % soma }));
  let falta = alvo - partes.reduce((s, p) => s + p.valor, 0);
  for (const p of [...partes].sort((a, b) => b.resto - a.resto || a.i - b.i)) {
    if (!falta) break;
    p.valor++; falta--;
  }
  return partes.map((p) => p.valor);
}

export function cenarioDoServico(s: ProjecaoServico, quantidade: number): Cenario {
  const qtd = Number.isFinite(quantidade) ? Math.min(Math.max(0, Math.floor(quantidade)), s.quantidadeMaxima) : 0;
  const receita = s.precoCentavos * qtd;
  const comissao = s.comissaoCentavos === null ? null : s.comissaoCentavos * qtd;
  return { quantidade: qtd, receitaCentavos: receita, comissaoCentavos: comissao,
    margemCentavos: s.custoCentavos === null || comissao === null ? null : receita - comissao - s.custoCentavos * qtd,
    minutos: s.duracaoMin * qtd };
}

const moeda = (n: number) => (n / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (n: number) => `${Math.round(n * 100)}%`;
export function leiturasDoPeriodo(a: IndicadoresReuniao, b: IndicadoresReuniao): LeituraReuniao[] {
  const out: LeituraReuniao[] = [];
  if (!a.atendimentos) out.push({ tipo: "atencao", titulo: "Período sem atendimentos concluídos", detalhe: "Ainda não há base para avaliar a produção da equipe.", acao: "Conferir registros e escolher um período com atividade." });
  if (b.faturamentoCentavos > 0) {
    const delta = a.faturamentoCentavos - b.faturamentoCentavos;
    out.push({ tipo: delta >= 0 ? "bom" : "atencao", titulo: `Faturamento ${delta >= 0 ? "cresceu" : "caiu"} ${pct(Math.abs(delta) / b.faturamentoCentavos)}`,
      detalhe: `${moeda(a.faturamentoCentavos)} contra ${moeda(b.faturamentoCentavos)} no intervalo anterior de mesmo tamanho.`,
      acao: delta >= 0 ? "Identificar quais serviços sustentaram a melhora e repetir as ações." : "Conferir ocupação, mix de serviços e cancelamentos antes de definir uma ação." });
  }
  if (a.ocupacao !== null) out.push({ tipo: a.ocupacao >= .8 ? "bom" : "oportunidade", titulo: `Ocupação de ${pct(a.ocupacao)}`,
    detalhe: `${a.ocupadoMin} de ${a.capacidadeMin} minutos de agenda disponível ocupados.`,
    acao: a.ocupacao >= .8 ? "Preservar pontualidade e qualidade; oferecer apenas adicionais que caibam na agenda." : "Ver janelas de encaixe e clientes com recompra vencida; receita adicional é uma possibilidade, não uma perda comprovada." });
  if (a.faltas) out.push({ tipo: "atencao", titulo: `${a.faltas} falta(s) de clientes`, detalhe: "Faltas não são atendimentos realizados nem provam uma falha do profissional.", acao: "Conferir confirmação dos horários e oportunidades de preencher vagas liberadas." });
  if (a.clientesComHistorico) out.push({ tipo: "bom", titulo: `${a.retornaram} cliente(s) retornaram`, detalhe: `Entre ${a.clientesComHistorico} clientes atendidos, estes já tinham visita concluída anterior ao período.`, acao: "Conferir preferências e serviços que podem ser recomprados." });
  return out;
}

function ocultarGrupo(g: GrupoReuniao, lucro: boolean, comissoes: boolean): GrupoReuniao {
  return { ...g, comissaoCentavos: comissoes ? g.comissaoCentavos : null, margemCentavos: lucro && comissoes ? g.margemCentavos : null };
}
function ocultarIndicadores(g: IndicadoresReuniao, lucro: boolean, comissoes: boolean): IndicadoresReuniao {
  return { ...g, comissaoCentavos: comissoes ? g.comissaoCentavos : null, margemCentavos: lucro && comissoes ? g.margemCentavos : null };
}
/** Projecao de resposta por lista permitida: nao basta esconder os campos no componente. */
export function protegerSnapshot(s: SnapshotReuniao, acesso: { lucro: boolean; comissoes: boolean; equipe: boolean }): SnapshotReuniao {
  const lucro = acesso.lucro && !acesso.equipe, comissoes = acesso.comissoes && !acesso.equipe;
  return { versao: s.versao, geradoEm: s.geradoEm, inicio: s.inicio, fim: s.fim, fuso: s.fuso, tipo: s.tipo,
    atual: ocultarIndicadores(s.atual, lucro, comissoes), anterior: ocultarIndicadores(s.anterior, lucro, comissoes),
    barbeiros: s.barbeiros.map((g) => ocultarGrupo(g, lucro, comissoes)), cadeiras: s.cadeiras.map((g) => ocultarGrupo(g, lucro, comissoes)),
    servicos: s.servicos.map((g) => ocultarGrupo(g, lucro, comissoes)), leituras: s.leituras, avisos: s.avisos,
    financeiro: lucro ? s.financeiro : null, mes: s.mes, qualidade: s.qualidade, desempenho: acesso.equipe ? [] : s.desempenho,
    diaria: s.diaria.map((d) => ({ ...d, comissaoAvulsaCentavos: comissoes ? d.comissaoAvulsaCentavos : null,
      comissaoPlanoCentavos: comissoes ? d.comissaoPlanoCentavos : null,
      cenarios: d.cenarios.map((c) => ({ ...c, comissaoAdicionalCentavos: comissoes ? c.comissaoAdicionalCentavos : null })) })) };
}
