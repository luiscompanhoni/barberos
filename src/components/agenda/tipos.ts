export type Status = "MARCADO" | "CONFIRMADO" | "CHEGOU" | "EM_ATENDIMENTO" | "CONCLUIDO" | "FALTOU" | "CANCELADO";

export type AgendamentoApi = {
  id: string;
  barbeiroId: string;
  inicio: string;
  fim: string;
  status: Status;
  origem: string;
  precoCentavos: number;
  observacao: string | null;
  semPreferencia: boolean;
  cliente: { id: string; nome: string; telefone: string; observacoes: string | null };
  servico: { id: string; nome: string };
  assinante: boolean;
};

export type IntervaloIso = { inicio: string; fim: string };

export type AgendaApi = {
  fuso: string;
  granularidadeMin: number;
  barbeiros: { id: string; nome: string; cor: string }[];
  agendamentos: AgendamentoApi[];
  dias: {
    data: string;
    barbeiros: { barbeiroId: string; janelas: IntervaloIso[]; bloqueios: (IntervaloIso & { id: string; motivo: string | null })[] }[];
  }[];
};

/** Uma "torre" da grade: um barbeiro num dia. */
export type Coluna = {
  chave: string;
  titulo: string;
  subtitulo?: string;
  cor: string;
  barbeiroId: string;
  data: string;
  janelas: IntervaloIso[];
  bloqueios: (IntervaloIso & { id: string; motivo: string | null })[];
};

export const ROTULO_STATUS: Record<Status, string> = {
  MARCADO: "Marcado",
  CONFIRMADO: "Confirmado",
  CHEGOU: "Chegou",
  EM_ATENDIMENTO: "Na cadeira",
  CONCLUIDO: "Concluído",
  FALTOU: "Faltou",
  CANCELADO: "Cancelado",
};

export const ROTULO_ORIGEM: Record<string, string> = {
  BOT: "WhatsApp",
  SITE: "Site",
  RECEPCAO: "Recepção",
  BARBEIRO: "Barbeiro",
  PAINEL: "Painel",
};

/** Monta as colunas: dia (uma por barbeiro) ou semana (uma por dia, mesmo barbeiro). */
export function montarColunas(agenda: AgendaApi, modo: "dia" | "semana"): Coluna[] {
  const cols: Coluna[] = [];
  for (const dia of agenda.dias) {
    for (const b of agenda.barbeiros) {
      const info = dia.barbeiros.find((x) => x.barbeiroId === b.id);
      const d = new Date(`${dia.data}T12:00:00Z`);
      cols.push({
        chave: `${b.id}|${dia.data}`,
        titulo: modo === "dia" ? b.nome : d.toLocaleDateString("pt-BR", { weekday: "short", timeZone: "UTC" }),
        subtitulo: modo === "semana" ? d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" }) : undefined,
        cor: b.cor,
        barbeiroId: b.id,
        data: dia.data,
        janelas: info?.janelas ?? [],
        bloqueios: info?.bloqueios ?? [],
      });
    }
  }
  return cols;
}
