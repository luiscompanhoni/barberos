import { limitesDoDia } from "@/lib/agenda/carregar";
import { dataLocal, instanteLocal, somarDias } from "@/lib/agenda/tempo";

export const PERIODOS = {
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  mes: "Este mês",
  mes_passado: "Mês passado",
  "90d": "Últimos 90 dias",
  ano: "Este ano",
} as const;
export type ChavePeriodo = keyof typeof PERIODOS;

export type Periodo = {
  chave: ChavePeriodo;
  rotulo: string;
  /** Instantes [de, ate) */
  de: number;
  ate: number;
  /** Dias locais (AAAA-MM-DD) cobertos, ate hoje no maximo */
  dias: string[];
  /** Mesmo tamanho, logo antes (para comparar) */
  anterior: { de: number; ate: number };
};

/** Resolve o periodo no fuso da barbearia. "agora" injetavel para testes. */
export function resolverPeriodo(chave: string | null | undefined, fuso: string, agora = Date.now()): Periodo {
  const k: ChavePeriodo = chave && chave in PERIODOS ? (chave as ChavePeriodo) : "30d";
  const hoje = dataLocal(agora, fuso);
  const fimHoje = limitesDoDia(hoje, fuso).fim;
  let dataDe: string;
  let dataAte = hoje;
  let ate = fimHoje;
  switch (k) {
    case "7d": dataDe = somarDias(hoje, -6); break;
    case "30d": dataDe = somarDias(hoje, -29); break;
    case "90d": dataDe = somarDias(hoje, -89); break;
    case "mes": dataDe = `${hoje.slice(0, 8)}01`; break;
    case "ano": dataDe = `${hoje.slice(0, 5)}01-01`; break;
    case "mes_passado": {
      const primeiroDeste = `${hoje.slice(0, 8)}01`;
      dataAte = somarDias(primeiroDeste, -1);
      dataDe = `${dataAte.slice(0, 8)}01`;
      ate = instanteLocal(primeiroDeste, 0, fuso);
      break;
    }
  }
  const de = instanteLocal(dataDe, 0, fuso);
  const dias: string[] = [];
  for (let d = dataDe; d <= dataAte; d = somarDias(d, 1)) dias.push(d);
  return { chave: k, rotulo: PERIODOS[k], de, ate, dias, anterior: { de: de - (ate - de), ate: de } };
}

/** Variacao relativa (null quando nao da para comparar). */
export const variacao = (atual: number, anterior: number) => (anterior ? (atual - anterior) / anterior : null);
