import { z } from "zod";
import { zPreset, zTitulos, type Preset } from "./templates";
import { temposValidos } from "../../../workers/video/tempos.mjs";

export const LIMITES = { clipes: 20, arquivo: 100 * 1024 * 1024, projeto: 500 * 1024 * 1024, usuario: 2 * 1024 * 1024 * 1024, global: 10 * 1024 * 1024 * 1024, saida: 150 * 1024 * 1024, segundos: 120, projetos: 10, versoes: 10 } as const;
export const ATIVOS = ["FILA", "PROCESSANDO"] as const;
export const ROTULOS: Record<string, string> = { FILA: "Na fila", PROCESSANDO: "Montando vídeo", REVISAO: "Pronto para revisar", APROVADO: "Aprovado", AJUSTES: "Alterações solicitadas", FALHOU: "Falha na montagem", CANCELADO: "Cancelado" };
export const zProjeto = z.object({ nome: z.string().trim().min(2).max(80), preset: zPreset.optional() }).strict();
export const zRevisao = z.number().int().min(0);
export const zClipe = z.object({ nome: z.string().trim().min(1).max(150), bytes: z.number().int().min(32).max(LIMITES.arquivo), mime: z.enum(["video/mp4", "video/quicktime", "video/webm"]), duracao: z.number().finite().min(0.1).max(1800), revisao: zRevisao });
export const zEdicao = z.object({ revisao: zRevisao, nome: zProjeto.shape.nome, preset: zPreset.optional(), titulo: zTitulos.titulo.optional(), chamada: zTitulos.chamada.optional(), clipes: z.array(z.object({ id: z.string().min(1).max(40), inicio: z.number().finite().min(0), fim: z.number().finite().min(0.1), texto: z.string().trim().max(100) }).strict()).max(LIMITES.clipes) }).strict();
export type Edicao = z.infer<typeof zEdicao>;
export type Snapshot = { preset: Preset; titulo?: string; chamada?: string; origem?: { execucaoId: string; resultadoHash: string; revisao: number }; clipes: { id: string; inicio: number; fim: number; texto: string; mime: string }[] };

export function validarCortes(clipes: { inicio: number; fim: number; duracao: number }[]) {
  return temposValidos(clipes) && clipes.every(c => Number.isFinite(c.duracao) && c.fim <= c.duracao + 0.05);
}

export function assinaturaValida(b: Uint8Array, mime: string) {
  if (mime === "video/webm") return b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
  return b.length >= 12 && String.fromCharCode(...b.slice(4, 8)) === "ftyp";
}

/** Uma faixa, inclusive suffix ranges. Valores inválidos retornam 416. */
export function faixa(h: string | null, tamanho: number): { inicio: number; fim: number } | null | false {
  if (!h) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(h);
  if (!m || (!m[1] && !m[2])) return false;
  const inicio = m[1] ? Number(m[1]) : Math.max(0, tamanho - Number(m[2]));
  const fim = m[1] && m[2] ? Math.min(Number(m[2]), tamanho - 1) : tamanho - 1;
  return Number.isSafeInteger(inicio) && Number.isSafeInteger(fim) && inicio >= 0 && inicio <= fim && inicio < tamanho ? { inicio, fim } : false;
}
