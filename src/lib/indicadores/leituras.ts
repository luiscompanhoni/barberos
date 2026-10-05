/**
 * Leituras automaticas: transforma os numeros em "o que fazer agora". Funcao pura (testada).
 */
export type Leitura = { tipo: "atencao" | "oportunidade" | "bom"; titulo: string; texto: string; acao?: { rotulo: string; href: string } };

type Entrada = {
  ocupacao: { taxa: number | null; capacidadeMin: number; ocupadoMin: number };
  porDiaSemana: { diaSemana: number; taxa: number | null }[];
  taxaFalta: number | null;
  retorno: { base: number; taxa: number | null };
  base: { ativo: number; risco: number; perdido: number };
  assinaturas: { ativas: number; churnMensal: number | null; assinantesSemUso: number; valorPorUsoCentavos: number | null; tabelaPorUsoCentavos: number | null };
  idade: { preenchidos: number; atendidos: number };
  origens: Record<string, number>;
  novos: number;
  bar: { comandas: number; barPorAtendimentoCentavos: number | null };
  atendimentos: number;
  automacoes?: { lembreteHorasAntes: number; reativacaoDias: number; posAtendimento: boolean; aniversario: boolean };
};

const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const reais = (c: number) => `R$ ${(c / 100).toFixed(2).replace(".", ",")}`;
const p = (v: number) => `${Math.round(v * 100)}%`;

export function gerarLeituras(e: Entrada): Leitura[] {
  const out: Leitura[] = [];
  const auto = e.automacoes;

  if (e.ocupacao.taxa !== null && e.ocupacao.taxa < 0.6) {
    const horas = Math.round((e.ocupacao.capacidadeMin - e.ocupacao.ocupadoMin) / 60);
    out.push({ tipo: "oportunidade", titulo: `${horas} horas de cadeira vazia no período`, texto: `A ocupação ficou em ${p(e.ocupacao.taxa)}. Cada hora vazia é receita perdida: vale um plano ou preço especial nos horários fracos.`, acao: { rotulo: "Ver planos", href: "/planos" } });
  }
  const dias = e.porDiaSemana.filter((d) => d.taxa !== null) as { diaSemana: number; taxa: number }[];
  if (dias.length >= 3) {
    const pior = dias.reduce((a, b) => (b.taxa < a.taxa ? b : a));
    const melhor = dias.reduce((a, b) => (b.taxa > a.taxa ? b : a));
    if (melhor.taxa - pior.taxa >= 0.2) {
      out.push({ tipo: "oportunidade", titulo: `${DIAS[pior.diaSemana][0].toUpperCase() + DIAS[pior.diaSemana].slice(1)} é o dia mais vazio`, texto: `${p(pior.taxa)} de ocupação contra ${p(melhor.taxa)} na ${DIAS[melhor.diaSemana]}. Um plano “dias de semana” mais barato ou um combo nesse dia equilibra a agenda.` });
    }
  }
  if (e.taxaFalta !== null && e.taxaFalta > 0.07) {
    out.push({ tipo: "atencao", titulo: `Faltas em ${p(e.taxaFalta)}`, texto: auto && auto.lembreteHorasAntes === 0 ? "O lembrete da véspera está desligado: ligue e peça confirmação." : "Acima do ideal (até 5%). Confira quem mais falta no painel e aplique o limite de faltas.", acao: { rotulo: "Automações", href: "/equipe" } });
  }
  if (e.retorno.taxa !== null && e.retorno.base >= 5 && e.retorno.taxa < 0.5) {
    out.push({ tipo: "atencao", titulo: `Só ${p(e.retorno.taxa)} dos clientes novos voltaram`, texto: "A segunda visita é a que fideliza. Mande agradecimento com convite para voltar e ofereça o plano na primeira visita.", acao: { rotulo: "Ligar agradecimento", href: "/equipe" } });
  }
  if (e.base.risco > 0) {
    out.push({ tipo: "oportunidade", titulo: `${e.base.risco} cliente(s) sumindo`, texto: `Não vêm há 45 a 90 dias. ${auto && auto.reativacaoDias === 0 ? "Ative “chamar de volta quem sumiu”." : "A mensagem automática de retorno já cuida deles; acompanhe quem respondeu."}`, acao: { rotulo: "Automações", href: "/equipe" } });
  }
  if (e.assinaturas.assinantesSemUso > 0) {
    out.push({ tipo: "atencao", titulo: `${e.assinaturas.assinantesSemUso} assinante(s) sem usar o plano`, texto: "Quem paga e não usa costuma cancelar no mês seguinte. Chame no WhatsApp e marque um horário.", acao: { rotulo: "Ver assinaturas", href: "/assinaturas" } });
  }
  if (e.assinaturas.churnMensal !== null && e.assinaturas.churnMensal > 0.05) {
    out.push({ tipo: "atencao", titulo: `Cancelamento de ${p(e.assinaturas.churnMensal)} ao mês`, texto: "Acima de 5% ao mês a base encolhe. Veja os motivos abaixo e ataque o principal.", acao: { rotulo: "Ver assinaturas", href: "/assinaturas" } });
  }
  const { valorPorUsoCentavos: v, tabelaPorUsoCentavos: t } = e.assinaturas;
  if (v !== null && t && v < t * 0.4) {
    out.push({ tipo: "atencao", titulo: "Plano rendendo pouco por corte", texto: `Cada corte pelo plano está saindo por ${reais(v)} (tabela ${reais(t)}). Revise o preço ou o intervalo entre visitas.`, acao: { rotulo: "Ver planos", href: "/planos" } });
  }
  if (e.atendimentos > 0 && e.bar.comandas === 0) {
    out.push({ tipo: "oportunidade", titulo: "Nenhuma venda do bar registrada", texto: "Abra a comanda em todo atendimento (botão “Comanda” na agenda): o bar e a loja passam a aparecer aqui, com margem." });
  }
  if (e.idade.atendidos >= 10 && e.idade.preenchidos / e.idade.atendidos < 0.3) {
    out.push({ tipo: "oportunidade", titulo: "Poucos clientes com data de nascimento", texto: `Só ${p(e.idade.preenchidos / e.idade.atendidos)} preenchidos. Com a data, dá para ver a idade do público e mandar parabéns com um mimo.`, acao: auto && !auto.aniversario ? { rotulo: "Ligar aniversário", href: "/equipe" } : undefined });
  }
  const semOrigem = e.origens.NAO_INFORMADO ?? 0;
  if (e.novos >= 5 && semOrigem / e.novos > 0.5) {
    out.push({ tipo: "oportunidade", titulo: "Não sabemos de onde vêm os clientes novos", texto: `${semOrigem} de ${e.novos} sem “como conheceu”. Preencha no cadastro para saber se Instagram, Google ou indicação trazem mais gente.` });
  }
  if (!out.length && e.atendimentos > 0) {
    out.push({ tipo: "bom", titulo: "Tudo dentro do esperado", texto: "Nenhum indicador fora do ideal neste período." });
  }
  return out;
}
