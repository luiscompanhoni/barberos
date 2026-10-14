import { z } from "zod";

export const schemaProduto = z.object({
  nome: z.string().trim().min(2).max(80),
  categoria: z.enum(["BAR", "LOJA", "USO_INTERNO"]),
  precoCentavos: z.number().int().min(0).max(100_000_00),
  custoCentavos: z.number().int().min(0).max(100_000_00).default(0),
  estoqueMinimo: z.number().int().min(0).max(100_000).default(0),
  unidade: z.string().trim().min(1).max(10).default("un"),
  codigoBarras: z.string().trim().max(40).nullish().transform((v) => v || null),
});

export const schemaMovimento = z.object({
  tipo: z.enum(["ENTRADA", "CONSUMO", "PERDA", "AJUSTE"]),
  quantidade: z.number().int().min(-100_000).max(100_000),
  custoUnitarioCentavos: z.number().int().min(0).max(100_000_00).nullish(),
  motivo: z.string().trim().max(200).nullish(),
});

export const schemaAcaoComanda = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("produto"), produtoId: z.string().min(1), quantidade: z.number().int().min(1).max(999).default(1) }),
  z.object({ acao: z.literal("avulso"), descricao: z.string().trim().min(2).max(80), precoCentavos: z.number().int().min(0).max(100_000_00), quantidade: z.number().int().min(1).max(999).default(1) }),
  z.object({ acao: z.literal("servico"), servicoId: z.string().min(1).max(40), barbeiroId: z.string().min(1).max(40) }),
  z.object({ acao: z.literal("desconto"), descontoCentavos: z.number().int().min(0).max(100_000_00) }),
  z.object({ acao: z.literal("fechar") }),
  z.object({ acao: z.literal("saldo") }),
  z.object({ acao: z.literal("cancelar"), motivo: z.string().trim().min(2).max(200) }),
]);

export const schemaPagamento = z.object({
  forma: z.enum(["DINHEIRO", "PIX", "CREDITO", "DEBITO"]),
  valorCentavos: z.number().int().min(1).max(100_000_00),
  naMaquininha: z.boolean().default(true),
  // Qual maquininha (numero de serie); sem informar, usa a primeira configurada.
  serial: z.string().trim().max(40).optional(),
});
