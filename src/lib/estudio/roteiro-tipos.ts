import { z } from "zod";
import { zProjeto, zRevisao } from "./regras";

export const zImportarRoteiro = zProjeto.extend({
  execucaoId: z.string().min(1).max(40), revisao: zRevisao,
  resultadoHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type ImportarRoteiro = z.infer<typeof zImportarRoteiro>;
export const zRoteiro = z.object({
  execucaoId: z.string(), agenteId: z.literal("conteudo"), tarefa: z.string(),
  revisao: z.number().int(), resultadoHash: z.string(), aprovadoPorId: z.string(),
  aprovadoEm: z.string(), importadoEm: z.string(), importadoPorId: z.string(),
  resumo: z.string(), entregaveis: z.array(z.string()), alertas: z.array(z.string()),
  proximosPassos: z.array(z.object({ agenteId: z.string(), tarefa: z.string() }).strict()),
}).strict();
export type Roteiro = z.infer<typeof zRoteiro>;
export type OpcaoRoteiro = { id: string; tarefa: string; revisao: number; resultadoHash: string; aprovadoEm: string };
