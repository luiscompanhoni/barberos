import { z } from "zod";

const dinheiro = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const quantidade = z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER);
const instante = z.iso.datetime({ offset: true });
export const metricasDesempenhoSchema = z.object({
  inicioEm: instante, fimEm: instante, consultadoEm: instante,
  gastoCentavos: dinheiro, impressoes: quantidade.int(), cliques: quantidade.int(),
  leads: quantidade.nullable(), conversoes: quantidade.nullable(), receitaCentavos: dinheiro.nullable(),
  fonteReceita: z.enum(["barberos_conciliado", "meta_atribuida", "ausente"]),
  atribuicaoCoerente: z.boolean(), escopoOrcamentoCompleto: z.boolean(),
}).strict().refine(m => +new Date(m.inicioEm) < +new Date(m.fimEm), "O início deve anteceder o fim.")
  .refine(m => (m.fonteReceita === "ausente") === (m.receitaCentavos === null), "Receita exige uma origem explícita.");
export const politicaDesempenhoSchema = z.object({
  diasMinimos: z.number().int().min(1).max(90), impressoesMinimas: quantidade.int().min(1), cliquesMinimos: quantidade.int().min(1),
  atrasoAtribuicaoHoras: z.number().int().min(0).max(24 * 30), maxIdadeColetaHoras: z.number().int().min(1).max(168),
  cplMaxCentavos: dinheiro.positive().nullable(), cpaMaxCentavos: dinheiro.positive().nullable(),
  roasMin: z.number().finite().positive().max(1000).nullable(), limiteGastoCentavos: dinheiro.positive().nullable(),
}).strict();
export type MetricasDesempenho = z.infer<typeof metricasDesempenhoSchema>;
export type PoliticaDesempenho = z.infer<typeof politicaDesempenhoSchema>;
export type EncaminhamentoDesempenho = {
  agenteId: "estrategia" | "conteudo" | "trafego";
  tarefa: string; exigeAprovacao: true;
};
export type ParecerDesempenho = {
  situacao: "INCONCLUSIVO" | "REVISAR" | "DENTRO_DA_META";
  metricas: { ctrPct: number | null; cplCentavos: number | null; cpaCentavos: number | null; roas: number | null; fonteReceita: MetricasDesempenho["fonteReceita"] };
  alertas: string[]; encaminhamentos: EncaminhamentoDesempenho[]; executaMudancas: false;
};

const dividir = (n: number, d: number | null) => d !== null && d > 0 ? n / d : null;
/** Critérios são configurados pelo responsável; amostra e atribuição não são substituídas pelo parecer do modelo. */
export function avaliarDesempenho(entrada: MetricasDesempenho, regras: PoliticaDesempenho, agora = new Date()): ParecerDesempenho {
  const m = metricasDesempenhoSchema.parse(entrada), p = politicaDesempenhoSchema.parse(regras);
  const fim = +new Date(m.fimEm), consulta = +new Date(m.consultadoEm), inicio = +new Date(m.inicioEm);
  if (!Number.isFinite(+agora) || fim > +agora || consulta > +agora || consulta < fim) throw new Error("Datas de observação ou coleta inválidas.");
  const metricas = {
    ctrPct: dividir(m.cliques * 100, m.impressoes), cplCentavos: dividir(m.gastoCentavos, m.leads),
    cpaCentavos: dividir(m.gastoCentavos, m.conversoes), roas: m.receitaCentavos === null ? null : dividir(m.receitaCentavos, m.gastoCentavos),
    fonteReceita: m.fonteReceita,
  };
  const alertas: string[] = [], encaminhamentos: EncaminhamentoDesempenho[] = [];
  const encaminhar = (agenteId: EncaminhamentoDesempenho["agenteId"], tarefa: string) => encaminhamentos.push({ agenteId, tarefa, exigeAprovacao: true });
  const fresco = +agora - consulta <= p.maxIdadeColetaHoras * 3_600_000;
  const tetoAtingido = p.limiteGastoCentavos !== null && m.escopoOrcamentoCompleto && m.gastoCentavos >= p.limiteGastoCentavos;
  if (tetoAtingido) {
    alertas.push("O gasto já observado atingiu o limite informado. A coleta pode estar atrasada; confira a veiculação imediatamente.");
    encaminhar("trafego", "Conferir gasto e limite na conta Meta e submeter eventual pausa à política aprovada; não aumentar orçamento.");
  } else if (p.limiteGastoCentavos !== null) {
    alertas.push(m.escopoOrcamentoCompleto
      ? "Gasto observado abaixo do limite não garante saldo disponível: insights podem ter atraso."
      : "O período não cobre todo o orçamento. Não foi inferido saldo restante nem limite disponível.");
  }
  let suficiente = true;
  const insuficiente = (mensagem: string) => { suficiente = false; alertas.push(mensagem); };
  if (!fresco) insuficiente("A coleta está desatualizada; atualizar os dados antes de recomendar ajustes.");
  if (fim - inicio < p.diasMinimos * 86_400_000) insuficiente("A janela observada é menor que o mínimo definido.");
  if (consulta - fim < p.atrasoAtribuicaoHoras * 3_600_000) insuficiente("A janela de atribuição ainda não amadureceu na data da coleta.");
  if (m.impressoes < p.impressoesMinimas || m.cliques < p.cliquesMinimos) insuficiente("A amostra ainda é insuficiente para os critérios definidos.");
  if (!m.atribuicaoCoerente) insuficiente("As fontes não têm atribuição comparável. Validar período, origem e deduplicação.");
  if (p.cplMaxCentavos === null && p.cpaMaxCentavos === null && p.roasMin === null) insuficiente("Defina uma meta de resultado antes de classificar a campanha.");
  if ((p.cplMaxCentavos !== null && m.leads === null) || (p.cpaMaxCentavos !== null && m.conversoes === null) || (p.roasMin !== null && m.receitaCentavos === null)) insuficiente("Faltam resultados necessários para avaliar as metas selecionadas.");
  if (m.gastoCentavos === 0) insuficiente("Sem gasto observado, custos por resultado e retorno de mídia não comprovam desempenho.");
  if (m.fonteReceita === "meta_atribuida") alertas.push("Receita atribuída pela Meta não é receita conciliada no caixa da barbearia.");
  if (!suficiente) {
    encaminhar("estrategia", "Rever a suficiência e a origem dos dados; aguardar observação adequada antes de alterar estratégia ou criativo.");
    return { situacao: tetoAtingido ? "REVISAR" : "INCONCLUSIVO", metricas, alertas, encaminhamentos, executaMudancas: false };
  }
  const cplRuim = p.cplMaxCentavos !== null && (m.leads === 0 || (metricas.cplCentavos ?? 0) > p.cplMaxCentavos);
  const cpaRuim = p.cpaMaxCentavos !== null && (m.conversoes === 0 || (metricas.cpaCentavos ?? 0) > p.cpaMaxCentavos);
  const roasRuim = p.roasMin !== null && (metricas.roas ?? 0) < p.roasMin;
  if (cplRuim || cpaRuim || roasRuim) {
    alertas.push("O resultado observado ficou fora de pelo menos uma meta. Isso não identifica sozinho a causa.");
    encaminhar("estrategia", "Comparar oferta, público, capacidade da agenda e conversão do atendimento; formular uma hipótese verificável.");
    encaminhar("conteudo", "Preparar uma variante de criativo alinhada à hipótese e encaminhar a versão para aprovação.");
    encaminhar("trafego", "Propor teste limitado de uma variável, preservando os tetos aprovados; não ativar ajustes sem aprovação.");
  }
  return { situacao: tetoAtingido || cplRuim || cpaRuim || roasRuim ? "REVISAR" : "DENTRO_DA_META", metricas,
    alertas, encaminhamentos, executaMudancas: false };
}
