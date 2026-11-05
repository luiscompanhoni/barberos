import type { OrigemAgendamento } from "@prisma/client";
import type { TitularAgenda } from "./cliente-identidade";

export type NovoAgendamento = {
  /** Somente a conferência da recepção vincula um pedido do cliente à reserva. */
  pedidoId?: string;
  titular?: TitularAgenda;
  barbeiroId: string;
  servicoId: string;
  servicosAdicionais?: string[];
  premioId?: string;
  precoEsperadoCentavos?: number;
  duracaoEsperadaMin?: number;
  inicio: Date;
  /** Duracao diferente da padrao (so equipe). */
  duracaoMin?: number;
  cadeiraId?: string | null;
  cliente: { id: string } | { telefone: string; nome: string };
  origem: OrigemAgendamento;
  observacao?: string;
  semPreferencia?: boolean;
  /** Assinante aceitou pagar quando a regra do plano nao cobre. */
  forcarAvulso?: boolean;
  /** Equipe registrando um atendimento que já terminou. */
  realizado?: boolean;
};

export type AlteracaoAgendamento = {
  inicio?: Date;
  fim?: Date;
  barbeiroId?: string;
  servicoId?: string;
  cadeiraId?: string | null;
  motivo?: string;
};
