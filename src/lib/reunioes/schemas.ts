import { z } from "zod";
import { zId } from "@/lib/validacao";

export const dataReal = z.iso.date();
export const periodoSchema = z.object({ inicio: dataReal, fim: dataReal }).refine((p) => p.fim >= p.inicio && Date.parse(p.fim) - Date.parse(p.inicio) <= 92 * 86400000, "Escolha até 93 dias, com início antes do fim.");
export const criarReuniaoSchema = z.object({ titulo: z.string().trim().min(3).max(120), tipo: z.enum(["DIARIA", "SEMANAL"]), inicio: dataReal, fim: dataReal })
  .refine((p) => periodoSchema.safeParse(p).success, "Período inválido: máximo 93 dias.")
  .refine((p) => p.tipo !== "DIARIA" || p.inicio === p.fim, "A reunião diária deve usar uma única data.");
export const acaoSchema = z.object({ id: z.string().min(1).max(80), texto: z.string().trim().min(3).max(500), barbeiroId: zId.nullable(), responsavel: z.string().trim().min(1).max(100), prazo: dataReal, concluida: z.boolean() });
export const editarReuniaoSchema = z.object({ versao: z.number().int().positive(), titulo: z.string().trim().min(3).max(120), conteudo: z.string().max(12000), acoes: z.array(acaoSchema).max(50) })
  .refine((p) => new Set(p.acoes.map((a) => a.id)).size === p.acoes.length, "As ações precisam de identificadores distintos.");
export const meuDiaSchema = z.object({ data: dataReal.optional(), barbeiroId: zId.optional() });
