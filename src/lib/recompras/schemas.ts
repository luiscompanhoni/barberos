import { z } from "zod";
import { zId, zInstante } from "@/lib/validacao";
import { ESTADOS } from "./regras";

export const schemaConfig = z.object({
  ativo: z.boolean(), whatsapp: z.boolean(), intervaloContatoDias: z.number().int().min(1).max(90),
  descontoAtivo: z.boolean(), descontoPct: z.number().int().min(0).max(50),
  descontoMaxCentavos: z.number().int().min(0).max(100_000),
  descontoValidadeDias: z.number().int().min(1).max(90), reativacaoDias: z.number().int().min(1).max(365),
  margemMinimaPct: z.number().int().min(0).max(100),
  servicos: z.array(z.object({ id: zId, intervaloRecompraDias: z.number().int().min(1).max(730).nullable(), custoCentavos: z.number().int().min(0).max(100_000_00).nullable() })).max(250),
}).superRefine((v, ctx) => {
  if (v.descontoAtivo && (!v.descontoPct || !v.descontoMaxCentavos)) ctx.addIssue({ code: "custom", message: "Defina percentual e limite do desconto antes de ativar.", path: ["descontoAtivo"] });
  if (new Set(v.servicos.map(s => s.id)).size !== v.servicos.length) ctx.addIssue({ code: "custom", message: "Serviço repetido.", path: ["servicos"] });
});
export const schemaOferta = z.object({
  agendamentoId: zId, servicoId: zId, estado: z.enum(ESTADOS), lembrarEm: zInstante.optional(),
  aplicarDesconto: z.boolean().default(false),
});
export type ConfigRecompra = z.infer<typeof schemaConfig>;
