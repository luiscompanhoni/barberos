/**
 * Tipos que o servidor manda para as telas dos jogos (sem nada de servidor: as telas importam daqui).
 */

export type TipoJogo = "ROLETA" | "CAIXA" | "RASPADINHA";
export type TipoPremio = "CREDITO" | "BRINDE" | "SERVICO" | "DESCONTO" | "NADA";
export type Raridade = "COMUM" | "RARO" | "EPICO" | "LENDARIO";
export type StatusPremio = "DISPONIVEL" | "RESERVADO" | "UTILIZADO" | "EXPIRADO" | "CANCELADO";
export type OrigemJogada = "ATENDIMENTO" | "GRATIS" | "CAMPANHA" | "INDICACAO" | "ANIVERSARIO" | "ASSINATURA" | "MANUAL" | "AVALIACAO";

/** Icones desenhados na tela (lista fixa). */
export const ICONES = ["dinheiro", "presente", "tesoura", "navalha", "pomada", "bebida", "coroa", "barba", "desconto", "estrela", "pente", "poste", "bigode", "nada"] as const;
export type Icone = (typeof ICONES)[number];

export type FatiaRoleta = { id: string; rotulo: string; cor: string; icone: string; tipo: TipoPremio; raridade: Raridade };
export type CelulaRaspadinha = { simbolo: string; rotulo: string; icone: string };

/** O que a tela anima (decidido no servidor antes da animacao). */
export type ResultadoJogada =
  | { tipo: "ROLETA"; fatias: FatiaRoleta[]; indice: number }
  | { tipo: "CAIXA"; quantidade: number }
  | { tipo: "RASPADINHA"; grade: CelulaRaspadinha[]; vencedoras: number[] };

export type PremioCliente = {
  id: string;
  codigo: string;
  jogoId: string;
  rotulo: string;
  tipo: TipoPremio;
  raridade: Raridade;
  icone: string;
  valorCentavos: number;
  percentual: number;
  status: StatusPremio;
  expiraEm: string | null;
  criadoEm: string;
  utilizadoEm: string | null;
  /** Horario reservado para usar o premio. */
  agendamento: { id: string; inicio: string } | null;
};

export type JogadaCliente = {
  id: string;
  jogoId: string;
  tipo: TipoJogo;
  vitoria: boolean;
  multiplicador: number;
  resultado: ResultadoJogada;
  premios: PremioCliente[];
  revelada: boolean;
  criadoEm: string;
};

export type VitrinePremio = { id: string; rotulo: string; tipo: TipoPremio; raridade: Raridade; icone: string; cor: string; chanceBps: number };

export type JogoCliente = {
  id: string;
  tipo: TipoJogo;
  nome: string;
  descricao: string | null;
  raridade: Raridade;
  premiosPorJogada: number;
  ativo: boolean;
  soAssinante: boolean;
  /** Jogadas que o cliente pode fazer agora. */
  fichas: number;
  proximaGratisEm: string | null;
  /** Como ganhar mais jogadas (textos curtos). */
  comoGanhar: string[];
  vitrine: VitrinePremio[];
  /** Roleta: as fatias na ordem da roda. */
  fatias: FatiaRoleta[];
  /** Jogada feita mas ainda nao revelada (caiu a conexao, atualizou a pagina...). */
  pendente: JogadaCliente | null;
};

export type CentralJogos = {
  jogos: JogoCliente[];
  multiplicador: number;
  assinante: boolean;
  premiosAtivos: number;
};

export const ROTULO_STATUS: Record<StatusPremio, string> = {
  DISPONIVEL: "Disponível",
  RESERVADO: "Reservado",
  UTILIZADO: "Utilizado",
  EXPIRADO: "Expirado",
  CANCELADO: "Cancelado",
};

export const ROTULO_RARIDADE: Record<Raridade, string> = { COMUM: "Comum", RARO: "Raro", EPICO: "Épico", LENDARIO: "Lendário" };

/** "R$ 10 no saldo", "Corte grátis", "15% de desconto"... */
export function descricaoPremio(p: { tipo: TipoPremio; rotulo: string; valorCentavos: number; percentual: number }) {
  if (p.tipo === "CREDITO") return `${(p.valorCentavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} de crédito no saldo`;
  if (p.tipo === "DESCONTO") return `${p.percentual}% de desconto na comanda`;
  if (p.tipo === "SERVICO") return "Serviço grátis no próximo atendimento";
  if (p.tipo === "BRINDE") return "Retire na barbearia";
  return "Não foi dessa vez";
}
