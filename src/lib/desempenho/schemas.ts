import { z } from "zod";
import { parseData } from "@/lib/agenda/tempo";

export const zCompetencia = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const zDia = z.string().refine((v) => { try { parseData(v); return true; } catch { return false; } }, "Informe uma data válida.");
export const TIPOS_MARCACAO = ["ENTRADA", "PAUSA", "RETORNO", "SAIDA"] as const;
export const zNotas = z.object({
  execucao: z.number().int().min(1).max(5),
  organizacao: z.number().int().min(1).max(5),
  atendimento: z.number().int().min(1).max(5),
  colaboracao: z.number().int().min(1).max(5),
});
const zFaixa = z.object({
  bonusCentavos: z.number().int().min(0).max(10_000_000),
  checklistMinPct: z.number().min(0).max(100),
  presencaMinPct: z.number().min(0).max(100),
  liderMin: z.number().min(1).max(5).nullable(),
  clientesMin: z.number().min(1).max(5).nullable(),
});
export const zPrograma = z.object({
  ativo: z.boolean(),
  toleranciaMin: z.number().int().min(0).max(60),
  pausaMaxMin: z.number().int().min(0).max(600).default(60),
  pontosPresenca: z.number().int().min(0).max(1500),
  pontosLider: z.number().int().min(0).max(1500),
  pontosClientes: z.number().int().min(0).max(1500),
  faixas: z.object({ ELITE: zFaixa, PLATINA: zFaixa, LEGEND: zFaixa }),
});
export type Programa = z.infer<typeof zPrograma>;
export type Notas = z.infer<typeof zNotas>;
export type TipoMarcacao = typeof TIPOS_MARCACAO[number];
export type Nivel = keyof Programa["faixas"];
const faixaInicial = () => ({ bonusCentavos: 0, checklistMinPct: 100, presencaMinPct: 100, liderMin: null, clientesMin: null });
export const PROGRAMA_INICIAL: Programa = {
  ativo: false, toleranciaMin: 5, pausaMaxMin: 60, pontosPresenca: 0, pontosLider: 0, pontosClientes: 0,
  faixas: { ELITE: faixaInicial(), PLATINA: faixaInicial(), LEGEND: faixaInicial() },
};
