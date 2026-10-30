import { describe, expect, it } from "vitest";
import { instanteLocal } from "@/lib/agenda/tempo";
import { apurarPresenca, elegibilidade, proximasMarcacoes, sequenciaValida } from "@/lib/desempenho/regras";
import { PROGRAMA_INICIAL, zDia, zPrograma } from "@/lib/desempenho/schemas";

const fuso = "America/Sao_Paulo";
const momento = (dia: string, min: number) => new Date(instanteLocal(dia, min, fuso));
const acordo = { inicio: "2026-10-05", diasSemana: [1], inicioMin: 540, fimMin: 1080, aceitaEm: momento("2026-10-04", 600), encerradaEm: momento("2026-10-06", 0) };
const marcacoes = (entrada: number, saida: number) => [
  { id: "e", tipo: "ENTRADA", instante: momento("2026-10-05", entrada) },
  { id: "s", tipo: "SAIDA", instante: momento("2026-10-05", saida) },
];
const apurar = (ms = marcacoes(540, 1080), extra: Partial<Parameters<typeof apurarPresenca>[0]> = {}) => apurarPresenca({ competencia: "2026-10", adesoes: [acordo], marcacoes: ms, justificativas: [], toleranciaMin: 5, agora: +momento("2026-11-01", 0), fuso, ...extra });

describe("presença: horário local, tolerância e dados incompletos", () => {
  it("aceita exatamente a tolerância e recusa um minuto além", () => {
    expect(apurar(marcacoes(545, 1075)).percentual).toBe(100);
    expect(apurar(marcacoes(546, 1080)).dias[0].estado).toBe("FORA_CRITERIO");
    expect(apurar(marcacoes(540, 1074)).percentual).toBe(0);
  });
  it("batidas ausentes viram pendência e nunca jornada inventada", () => {
    const r = apurar([]);
    expect(r.pendentes).toBe(1);
    expect(r.dias[0]).toMatchObject({ estado: "PENDENTE", minutos: null });
  });
  it("jornada ainda aberta não entra na comparação", () => {
    const r = apurar(marcacoes(540, 1080).slice(0, 1), { agora: +momento("2026-10-05", 600) });
    expect(r.previstos).toBe(0);
    expect(r.dias[0].estado).toBe("FUTURO");
  });
  it("folga sai do denominador e abono mantém a justificativa", () => {
    expect(apurar([], { justificativas: [{ data: "2026-10-05", tipo: "FOLGA", motivo: "Folga combinada" }] }).previstos).toBe(0);
    const r = apurar([], { justificativas: [{ data: "2026-10-05", tipo: "ABONO", motivo: "Falha confirmada no registro" }] });
    expect(r.percentual).toBe(100);
    expect(r.dias[0].motivo).toContain("Falha");
  });
  it("adesão não aceita ou aceita depois do início não conta retroativamente", () => {
    expect(apurar([], { adesoes: [{ ...acordo, aceitaEm: null }] }).dias).toHaveLength(0);
    expect(apurar([], { adesoes: [{ ...acordo, aceitaEm: momento("2026-10-05", 541) }] }).dias).toHaveLength(0);
  });
  it("desconta pausas dos minutos registrados", () => {
    const r = apurar([
      marcacoes(540, 1080)[0], { id: "p", tipo: "PAUSA", instante: momento("2026-10-05", 720) },
      { id: "r", tipo: "RETORNO", instante: momento("2026-10-05", 780) }, marcacoes(540, 1080)[1],
    ]);
    expect(r.dias[0].minutos).toBe(480);
  });
  it("entrada e saída pontuais não escondem uma pausa maior que o combinado", () => {
    const ms = [marcacoes(540, 1080)[0], { id: "p", tipo: "PAUSA", instante: momento("2026-10-05", 600) }, { id: "r", tipo: "RETORNO", instante: momento("2026-10-05", 1000) }, marcacoes(540, 1080)[1]];
    expect(apurar(ms, { pausaMaxMin: 60 }).dias[0].estado).toBe("FORA_CRITERIO");
  });
  it("não aprova sequência invertida, retorno sem pausa ou horários iguais", () => {
    expect(sequenciaValida(marcacoes(1080, 540))).toBe(false);
    expect(sequenciaValida(marcacoes(540, 540))).toBe(false);
    expect(sequenciaValida([{ id: "r", tipo: "RETORNO", instante: momento("2026-10-05", 600) }])).toBe(false);
    expect(proximasMarcacoes(["ENTRADA", "PAUSA"])).toEqual(["RETORNO"]);
    expect(proximasMarcacoes(["ENTRADA", "SAIDA"])).toEqual([]);
  });
});

describe("bônus: requisitos completos e fontes sem dupla contagem", () => {
  function base() {
    const programa = structuredClone(PROGRAMA_INICIAL);
    programa.ativo = true; programa.pontosPresenca = 10; programa.pontosLider = 15; programa.pontosClientes = 20;
    programa.faixas.ELITE = { bonusCentavos: 10000, checklistMinPct: 100, presencaMinPct: 100, liderMin: 4, clientesMin: 4.5 };
    return { programa, nivel: "ELITE" as const, mesEncerrado: true, adesao: true, presenca: { percentual: 100, pendentes: 0, previstos: 2 }, checklist: { total: 8, validados: 8 }, lider: { media: 4.5, diasAvaliados: 2 }, clientes: { media: 4.8, quantidade: 5 }, ajustesPendentes: 0 };
  }
  it("concede somente o valor da faixa e as fontes novas, sem repetir pontos do checklist", () => {
    expect(elegibilidade(base())).toMatchObject({ elegivel: true, bonusCentavos: 10000, pontos: 45 });
  });
  it.each(["mesEncerrado", "adesao"] as const)("não fecha sem %s", (campo) => {
    expect(elegibilidade({ ...base(), [campo]: false })).toMatchObject({ elegivel: false, bonusCentavos: 0, pontos: 0 });
  });
  it("aguarda no mínimo cinco avaliações, mesmo com média 5", () => {
    const r = elegibilidade({ ...base(), clientes: { media: 5, quantidade: 4 } });
    expect(r.elegivel).toBe(false);
    expect(r.pendencias.join(" ")).toContain("em formação");
  });
  it("não confunde nota semanal com cobertura diária completa", () => {
    expect(elegibilidade({ ...base(), lider: { media: 5, diasAvaliados: 1 } }).elegivel).toBe(false);
  });
  it("correção pendente impede aprovação", () => {
    expect(elegibilidade({ ...base(), ajustesPendentes: 1 }).elegivel).toBe(false);
  });
  it("não concede pontos de liderança/clientes quando esses critérios não foram exigidos", () => {
    const p = base(); p.programa.faixas.ELITE.liderMin = null; p.programa.faixas.ELITE.clientesMin = null;
    expect(elegibilidade({ ...p, lider: { media: null, diasAvaliados: 0 }, clientes: { media: null, quantidade: 0 } })).toMatchObject({ elegivel: true, pontos: 10 });
  });
  it("não concede bônus por falta de qualquer jornada elegível", () => {
    expect(elegibilidade({ ...base(), presenca: { percentual: null, pendentes: 0, previstos: 0 } }).elegivel).toBe(false);
  });
  it("programa começa desativado e sem valores financeiros presumidos", () => {
    expect(PROGRAMA_INICIAL.ativo).toBe(false);
    expect(Object.values(PROGRAMA_INICIAL.faixas).every((f) => f.bonusCentavos === 0)).toBe(true);
    expect(zPrograma.safeParse({ ...PROGRAMA_INICIAL, toleranciaMin: -1 }).success).toBe(false);
    expect(zDia.safeParse("2026-02-30").success).toBe(false);
  });
});
