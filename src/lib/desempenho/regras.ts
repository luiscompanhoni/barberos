import { dataLocal, diaSemana, instanteLocal, somarDias } from "@/lib/agenda/tempo";
import { intervaloCompetencia } from "@/lib/rh/regras";
import type { Nivel, Notas, Programa, TipoMarcacao } from "./schemas";

export type Marcacao = { id: string; tipo: string; instante: Date | string };
export type Adesao = { inicio: string; diasSemana: number[]; inicioMin: number; fimMin: number; aceitaEm: Date | string | null; encerradaEm: Date | string | null };
export type DiaPresenca = { data: string; estado: "CUMPRIU" | "FORA_CRITERIO" | "PENDENTE" | "FOLGA" | "FUTURO"; minutos: number | null; motivo: string };

/** Uma jornada por dia; pausa exige retorno antes de encerrar. */
export function proximasMarcacoes(tipos: string[]): TipoMarcacao[] {
  const ultimo = tipos.at(-1);
  if (!ultimo) return ["ENTRADA"];
  if (ultimo === "ENTRADA" || ultimo === "RETORNO") return ["PAUSA", "SAIDA"];
  return ultimo === "PAUSA" ? ["RETORNO"] : [];
}

export function sequenciaValida(marcacoes: Marcacao[]): boolean {
  const tipos: string[] = [];
  let ultimo = -Infinity;
  for (const m of marcacoes) {
    const instante = +new Date(m.instante);
    if (!Number.isFinite(instante) || instante <= ultimo || !proximasMarcacoes(tipos).includes(m.tipo as TipoMarcacao)) return false;
    ultimo = instante;
    tipos.push(m.tipo);
  }
  return true;
}

export const mediaNotas = (notas: Notas) => Object.values(notas).reduce((s, n) => s + n, 0) / 4;

/** Ausência de batida é pendência de conferência, nunca desconto automático. */
export function apurarPresenca(p: {
  competencia: string; adesoes: Adesao[]; marcacoes: Marcacao[];
  justificativas: { data: string; tipo: string; motivo: string }[];
  toleranciaMin: number; pausaMaxMin?: number; agora: number; fuso: string;
}) {
  const { inicio, fim } = intervaloCompetencia(p.competencia);
  const dias: DiaPresenca[] = [];
  for (let data = inicio; data <= fim; data = somarDias(data, 1)) {
    const adesao = p.adesoes.filter((a) => a.aceitaEm && a.inicio <= data
      && +new Date(a.aceitaEm) <= instanteLocal(data, a.inicioMin, p.fuso)
      && (!a.encerradaEm || data < dataLocal(new Date(a.encerradaEm), p.fuso)))
      .sort((a, b) => b.inicio.localeCompare(a.inicio))[0];
    if (!adesao || !adesao.diasSemana.includes(diaSemana(data))) continue;
    const inicioDia = instanteLocal(data, adesao.inicioMin, p.fuso);
    const fimDia = instanteLocal(data, adesao.fimMin, p.fuso);
    if (fimDia > p.agora) { dias.push({ data, estado: "FUTURO", minutos: null, motivo: "Jornada ainda não encerrada" }); continue; }
    const justificativa = p.justificativas.find((j) => j.data === data);
    if (justificativa) {
      dias.push({ data, estado: justificativa.tipo === "FOLGA" ? "FOLGA" : "CUMPRIU", minutos: null, motivo: justificativa.motivo });
      continue;
    }
    const ms = p.marcacoes.filter((m) => dataLocal(new Date(m.instante), p.fuso) === data).sort((a, b) => +new Date(a.instante) - +new Date(b.instante));
    if (!sequenciaValida(ms) || ms.at(-1)?.tipo !== "SAIDA") {
      dias.push({ data, estado: "PENDENTE", minutos: null, motivo: "Marcações incompletas; conferir com a gestão" });
      continue;
    }
    const primeiro = +new Date(ms[0].instante), ultimo = +new Date(ms.at(-1)!.instante);
    let pausas = 0;
    for (let i = 0; i < ms.length; i++) if (ms[i].tipo === "PAUSA") pausas += +new Date(ms[i + 1].instante) - +new Date(ms[i].instante);
    const pausaExcedida = p.pausaMaxMin !== undefined && pausas > p.pausaMaxMin * 60_000;
    const cumpriu = !pausaExcedida && primeiro <= inicioDia + p.toleranciaMin * 60_000 && ultimo >= fimDia - p.toleranciaMin * 60_000;
    dias.push({ data, estado: cumpriu ? "CUMPRIU" : "FORA_CRITERIO", minutos: Math.round((ultimo - primeiro - pausas) / 60_000), motivo: cumpriu ? "Horários combinados cumpridos" : pausaExcedida ? "Pausas acima do limite combinado" : "Entrada ou saída fora da tolerância" });
  }
  const considerados = dias.filter((d) => d.estado !== "FOLGA" && d.estado !== "FUTURO");
  const pendentes = considerados.filter((d) => d.estado === "PENDENTE").length;
  const cumpridos = considerados.filter((d) => d.estado === "CUMPRIU").length;
  return { dias, previstos: considerados.length, cumpridos, pendentes, percentual: considerados.length ? 100 * cumpridos / considerados.length : null };
}

export function elegibilidade(p: {
  programa: Programa; nivel: Nivel; mesEncerrado: boolean; adesao: boolean;
  presenca: { percentual: number | null; pendentes: number; previstos: number };
  checklist: { total: number; validados: number };
  lider: { media: number | null; diasAvaliados: number };
  clientes: { media: number | null; quantidade: number };
  ajustesPendentes: number;
}) {
  const faixa = p.programa.faixas[p.nivel], pendencias: string[] = [], criterios: { nome: string; cumpriu: boolean; detalhe: string }[] = [];
  if (!p.programa.ativo) pendencias.push("Programa de bônus desativado");
  if (!p.adesao) pendencias.push("Adesão ao programa não confirmada");
  if (!p.mesEncerrado) pendencias.push("Competência ainda em andamento");
  if (p.ajustesPendentes) pendencias.push("Há correções de presença aguardando revisão");
  if (!p.presenca.previstos) pendencias.push("Sem jornadas elegíveis nesta competência");
  if (p.presenca.pendentes) pendencias.push(`${p.presenca.pendentes} dia(s) com marcações pendentes de conferência`);
  const presencaOk = p.presenca.percentual !== null && p.presenca.percentual >= faixa.presencaMinPct;
  criterios.push({ nome: "Presença", cumpriu: presencaOk, detalhe: `${p.presenca.percentual?.toFixed(1) ?? "—"}% / mínimo ${faixa.presencaMinPct}%` });
  const checklistPct = p.checklist.total ? 100 * p.checklist.validados / p.checklist.total : null;
  const checklistOk = faixa.checklistMinPct === 0 || (checklistPct !== null && checklistPct >= faixa.checklistMinPct);
  if (faixa.checklistMinPct > 0 && checklistPct === null) pendencias.push("Checklist ainda sem tarefas no período");
  criterios.push({ nome: "Checklist", cumpriu: checklistOk, detalhe: `${p.checklist.validados}/${p.checklist.total} tarefas validadas / mínimo ${faixa.checklistMinPct}%` });
  const liderOk = faixa.liderMin === null || (p.lider.media !== null && p.lider.media >= faixa.liderMin && p.lider.diasAvaliados >= p.presenca.previstos);
  if (faixa.liderMin !== null && (p.lider.media === null || p.lider.diasAvaliados < p.presenca.previstos)) pendencias.push("Avaliações diárias da liderança ainda incompletas");
  criterios.push({ nome: "Liderança", cumpriu: liderOk, detalhe: faixa.liderMin === null ? "Não exigida nesta regra" : `${p.lider.media?.toFixed(2) ?? "—"}/5 / mínimo ${faixa.liderMin}` });
  const clientesOk = faixa.clientesMin === null || (p.clientes.quantidade >= 5 && p.clientes.media !== null && p.clientes.media >= faixa.clientesMin);
  if (faixa.clientesMin !== null && p.clientes.quantidade < 5) pendencias.push("Nota dos clientes em formação: aguarde pelo menos 5 avaliações publicadas");
  criterios.push({ nome: "Clientes", cumpriu: clientesOk, detalhe: faixa.clientesMin === null ? "Não exigida nesta regra" : `${p.clientes.media?.toFixed(2) ?? "—"}/5 / mínimo ${faixa.clientesMin}` });
  const elegivel = pendencias.length === 0 && criterios.every((c) => c.cumpriu);
  const pontos = elegivel ? p.programa.pontosPresenca + (faixa.liderMin !== null ? p.programa.pontosLider : 0) + (faixa.clientesMin !== null ? p.programa.pontosClientes : 0) : 0;
  return { elegivel, pendencias, criterios, pontos, bonusCentavos: elegivel ? faixa.bonusCentavos : 0, previstoCentavos: faixa.bonusCentavos };
}
