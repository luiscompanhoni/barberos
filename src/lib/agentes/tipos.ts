export type ResultadoAgente = {
  resumo: string;
  entregaveis: string[];
  alertas: string[];
  proximosPassos: { agenteId: string; tarefa: string }[];
};
export type IntegracaoAgente = { id: string; nome: string; disponivel: boolean; detalhe: string };
export type ExecucaoAgente = {
  id: string; agenteId: string; tarefa: string; estado: string; revisao: number;
  resultado: ResultadoAgente | null; resultadoHash: string | null; erro: string | null;
  criadoEm: string; finalizadoEm: string | null; origemId: string | null;
  fontes: { nome: string; consultadoEm: string }[];
  modelo: string | null; tokensEntrada: number; tokensSaida: number;
};
export type RotinaAgente = {
  id: string; nome: string; agenteId: string; tarefa: string;
  cadaMinutos: number; ativa: boolean; revisao: number; proximaEm: string;
};
export type PainelAgentes = {
  catalogo: { id: string; nome: string; objetivo: string; grupo: string; integracoes: readonly string[]; proximos: readonly string[] }[];
  integracoes: IntegracaoAgente[];
  execucoes: ExecucaoAgente[];
  rotinas: RotinaAgente[];
  configuracao: { pausada: boolean; limiteDiario: number; revisao: number };
  execucaoHabilitada: boolean;
};
