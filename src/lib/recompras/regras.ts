import { dataLocal, parseData } from "@/lib/agenda/tempo";
import { calcularComissao, type Regra } from "@/lib/rh/regras";

export const DIA = 86_400_000;
export const ESTADOS = ["OFERECIDO", "ACEITOU", "RECUSOU", "LEMBRAR"] as const;
export type EstadoOferta = (typeof ESTADOS)[number];

/** Dias de calendario da barbearia, inclusive quando o intervalo cruza mudanca de fuso. */
export function diasDecorridos(ultima: Date, data: string, fuso: string) {
  parseData(data);
  return Math.floor((Date.parse(data) - Date.parse(dataLocal(ultima, fuso))) / DIA);
}

export function podeRecomendar(p: { dias: number; intervalo: number; agendado: boolean; estado?: string; lembrarEm?: Date | null; agora: number }) {
  if (p.intervalo <= 0 || p.dias < p.intervalo || p.agendado) return false;
  if (p.estado === "RECUSOU" || p.estado === "ACEITOU") return false;
  return p.estado !== "LEMBRAR" || (!!p.lembrarEm && +p.lembrarEm <= p.agora);
}

export type PoliticaDesconto = {
  descontoAtivo: boolean; descontoPct: number; descontoMaxCentavos: number;
  descontoValidadeDias: number; reativacaoDias: number; margemMinimaPct: number;
};

/** Desconto somente com custo/comissao conhecidos e margem minima preservada. */
export function descontoReativacao(p: {
  politica: PoliticaDesconto; preco: number; custo: number | null; regra: Regra | null;
  adicionalBps: number; diasSemVisita: number; cobertoPlano: boolean; expirou?: boolean;
}) {
  const cfg = p.politica;
  if (!cfg.descontoAtivo || p.cobertoPlano || p.expirou || p.diasSemVisita < cfg.reativacaoDias || p.custo === null || !p.regra || p.preco <= 0) return 0;
  const desconto = Math.min(Math.floor(p.preco * cfg.descontoPct / 100), cfg.descontoMaxCentavos);
  const novoPreco = p.preco - desconto;
  const comissao = calcularComissao(p.regra, { modalidade: "AVULSO", preco: novoPreco, precoTabela: p.preco }, p.adicionalBps).comissao;
  const margem = novoPreco - p.custo - comissao;
  return novoPreco > 0 && margem * 100 >= novoPreco * cfg.margemMinimaPct ? desconto : 0;
}

export function chaveAviso(clienteId: string, ciclos: { servicoId: string; ultimaEm: string }[], rodada: number) {
  return `${clienteId}:${ciclos.map(c => `${c.servicoId}@${c.ultimaEm}`).sort().join("|")}:${rodada}`;
}
