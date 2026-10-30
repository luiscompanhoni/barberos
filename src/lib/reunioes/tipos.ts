export type AcaoReuniao = { id: string; texto: string; barbeiroId: string | null; responsavel: string; prazo: string; concluida: boolean };
export type GrupoReuniao = {
  id: string; nome: string; atendimentos: number; avulsos: number; assinantes: number;
  vendasCentavos: number; receitaAssinaturasCentavos: number; comissaoCentavos: number | null;
  margemCentavos: number | null; custosPendentes: number; faltas: number; cancelamentos: number;
};
export type IndicadoresReuniao = {
  atendimentos: number; avulsos: number; assinantes: number; clientes: number; faltas: number; cancelamentos: number;
  vendasCentavos: number; mensalidadesCentavos: number; faturamentoCentavos: number; estornosCentavos: number;
  ocupacao: number | null; capacidadeMin: number; ocupadoMin: number; ticketAvulsoCentavos: number | null;
  retornaram: number; clientesComHistorico: number; comissaoCentavos: number | null;
  margemCentavos: number | null; custosPendentes: number;
};
export type LeituraReuniao = { tipo: "bom" | "atencao" | "oportunidade"; titulo: string; detalhe: string; acao: string };
export type SnapshotReuniao = {
  versao: 1; geradoEm: string; inicio: string; fim: string; fuso: string; tipo: "DIARIA" | "SEMANAL";
  atual: IndicadoresReuniao; anterior: IndicadoresReuniao;
  barbeiros: GrupoReuniao[]; cadeiras: GrupoReuniao[]; servicos: GrupoReuniao[];
  leituras: LeituraReuniao[]; avisos: string[];
  financeiro: null | { mes: string; receitasCentavos: number; despesasCentavos: number; resultadoCaixaCentavos: number };
  mes: { inicio: string; fim: string; faturamentoCentavos: number; atendimentos: number };
  qualidade: { barbeiroId: string; nome: string; media: number | null; quantidade: number }[];
  desempenho: { barbeiroId: string; nome: string; presencaPercentual: number | null; checklistTotal: number; checklistValidados: number; mediaLider: number | null }[];
  diaria: { barbeiroId: string; nome: string; clientes: number; assinantes: number; avulsos: number; receitaPrevistaCentavos: number;
    comissaoAvulsaCentavos: number | null; comissaoPlanoCentavos: number | null; planoPendente: boolean; prioridades: string[];
    cenarios: { servico: string; quantidadeMaxima: number; receitaAdicionalCentavos: number; comissaoAdicionalCentavos: number | null }[] }[];
};
export type ReuniaoResposta = {
  id: string; titulo: string; tipo: string; inicio: string; fim: string; snapshot: SnapshotReuniao;
  conteudo: string; acoes: AcaoReuniao[]; versao: number; criadoEm: string;
  podeEditar: boolean; apresentacaoEquipe: boolean;
};
export type ListaReuniao = Pick<ReuniaoResposta, "id" | "titulo" | "tipo" | "inicio" | "fim" | "criadoEm">;
export type ProjecaoServico = {
  servicoId: string; nome: string; precoCentavos: number; duracaoMin: number; custoCentavos: number | null;
  comissaoCentavos: number | null; quantidadeMaxima: number;
  janelas?: { inicio: string; fim: string }[];
};
export type Cenario = { quantidade: number; receitaCentavos: number; comissaoCentavos: number | null; margemCentavos: number | null; minutos: number };
