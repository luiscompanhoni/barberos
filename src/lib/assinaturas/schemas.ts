import { z } from "zod";
import { MOTIVOS } from "./retencao-regras";

/** Cadastro/edicao de plano (painel do dono). */
export const schemaPlano = z.object({
  nome: z.string().trim().min(2).max(80),
  descricao: z.string().trim().max(500).nullable().optional(),
  precoCentavos: z.number().int().min(100).max(100_000_00),
  ativo: z.boolean().optional(),
  vagas: z.number().int().min(1).max(100_000).nullable().optional(),
  intervaloMinDias: z.number().int().min(1).max(60).nullable().optional(),
  maxAgendamentosAbertos: z.number().int().min(1).max(10).optional(),
  diasSemana: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  descontoExtrasPct: z.number().int().min(0).max(100).optional(),
  formasPagamento: z.array(z.enum(["CARTAO", "PIX", "BOLETO"])).min(1).optional(),
  servicos: z.array(z.object({ servicoId: z.string(), usosPorCiclo: z.number().int().min(1).max(100).nullable() })).min(1),
  barbeiroIds: z.array(z.string()).optional(),
});

/** Motivos de cancelamento (rotulos; codigos em retencao-regras): viram relatorio de por que os assinantes saem. */
export const MOTIVOS_CANCELAMENTO = [
  "Ficou caro",
  "Não estou usando o suficiente",
  "Vou viajar",
  "Mudei de cidade ou de bairro",
  "Horários não batem com os meus",
  "Insatisfeito com o atendimento",
  "Outro motivo",
] as const;

/** Pedido do cliente na tela de cancelamento (site). */
export const schemaPedidoCancelamento = z.object({
  acao: z.enum(["desconto", "pausa", "gerente", "cancelar"]),
  motivo: z.enum(MOTIVOS),
  detalhe: z.string().trim().max(200).optional(),
  dias: z.number().int().min(1).max(365).optional(),
});

/** Ofertas de retencao (so o dono). */
export const schemaConfigRetencao = z.object({
  descontoAtivo: z.boolean(),
  descontoPct: z.number().int().min(1).max(100),
  descontoMeses: z.number().int().min(1).max(12),
  pausaAtiva: z.boolean(),
  pausaMaxDias: z.number().int().min(7).max(180),
});
