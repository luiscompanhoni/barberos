/**
 * Validacao (zod) da configuracao dos jogos vinda do painel.
 */
import { z } from "zod";
import { ICONES } from "./tipos";

const dinheiro = z.number().int().min(0).max(1_000_000);

export const zPremio = z.object({
  id: z.string().max(40).optional(),
  rotulo: z.string().trim().min(1).max(24),
  tipo: z.enum(["CREDITO", "BRINDE", "SERVICO", "DESCONTO", "NADA"]),
  valorCentavos: dinheiro,
  percentual: z.number().int().min(0).max(100),
  servicoId: z.string().max(40).nullable(),
  chanceBps: z.number().int().min(0).max(10_000),
  raridade: z.enum(["COMUM", "RARO", "EPICO", "LENDARIO"]),
  cor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  icone: z.enum(ICONES),
  ativo: z.boolean(),
  limiteMensal: z.number().int().min(0).max(100_000).nullable(),
  estoque: z.number().int().min(0).max(1_000_000).nullable(),
  custoCentavos: dinheiro,
});

const instante = z.iso.datetime({ offset: true }).transform((s) => new Date(s)).nullable();

export const zConfig = z.object({
  nome: z.string().trim().min(2).max(40),
  descricao: z.string().trim().max(120).nullable(),
  ativo: z.boolean(),
  premiosPorJogada: z.number().int().min(1).max(5),
  raridade: z.enum(["COMUM", "RARO", "EPICO", "LENDARIO"]),
  validadeDias: z.number().int().min(1).max(365),
  bonusAssinantePct: z.number().int().min(0).max(200),
  inicioEm: instante,
  fimEm: instante,
  limitePorPessoaMes: z.number().int().min(1).max(1000).nullable(),
  jogadasPorAtendimento: z.number().int().min(0).max(10),
  valorMinimoAtendimentoCentavos: dinheiro,
  soAssinante: z.boolean(),
  jogadasPorIndicacao: z.number().int().min(0).max(10),
  jogadasAniversario: z.number().int().min(0).max(10),
  jogadasRenovacaoPlano: z.number().int().min(0).max(10),
  gratisACadaDias: z.number().int().min(0).max(365),
});
