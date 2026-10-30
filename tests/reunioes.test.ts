import { describe, expect, it } from "vitest";
import { cenarioDoServico, leiturasDoPeriodo, protegerSnapshot, ratearCentavos } from "@/lib/reunioes/regras";
import { criarReuniaoSchema, editarReuniaoSchema } from "@/lib/reunioes/schemas";
import { combinarCenarios } from "@/lib/reunioes/cenarios";
import type { GrupoReuniao, IndicadoresReuniao, SnapshotReuniao } from "@/lib/reunioes/tipos";

const indicador: IndicadoresReuniao = { atendimentos: 10, avulsos: 5, assinantes: 5, clientes: 10, faltas: 1, cancelamentos: 1, vendasCentavos: 32500, mensalidadesCentavos: 10000, faturamentoCentavos: 42500, estornosCentavos: 0, ocupacao: .7, capacidadeMin: 600, ocupadoMin: 420, ticketAvulsoCentavos: 6500, retornaram: 3, clientesComHistorico: 10, comissaoCentavos: 13000, margemCentavos: 19500, custosPendentes: 0 };
const grupo: GrupoReuniao = { id: "bb", nome: "Barbeiro", atendimentos: 10, avulsos: 5, assinantes: 5, vendasCentavos: 32500, receitaAssinaturasCentavos: 10000, comissaoCentavos: 13000, margemCentavos: 19500, custosPendentes: 0, faltas: 1, cancelamentos: 1 };
const snapshot: SnapshotReuniao = { versao: 1, tipo: "DIARIA", geradoEm: "2026-10-28T12:00:00Z", inicio: "2026-10-21", fim: "2026-10-27", fuso: "America/Sao_Paulo", atual: indicador, anterior: indicador, barbeiros: [grupo], cadeiras: [grupo], servicos: [grupo], avisos: [], leituras: [], mes: { inicio: "2026-10-01", fim: "2026-10-27", faturamentoCentavos: 42500, atendimentos: 10 }, financeiro: { mes: "2026-10", receitasCentavos: 42500, despesasCentavos: 20000, resultadoCaixaCentavos: 22500 }, qualidade: [], desempenho: [{ barbeiroId: "bb", nome: "Barbeiro", presencaPercentual: 100, checklistTotal: 10, checklistValidados: 10, mediaLider: 4 }], diaria: [{ barbeiroId: "bb", nome: "Barbeiro", clientes: 10, avulsos: 5, assinantes: 5, receitaPrevistaCentavos: 32500, comissaoAvulsaCentavos: 13000, comissaoPlanoCentavos: null, planoPendente: true, prioridades: [], cenarios: [{ servico: "Sobrancelha", quantidadeMaxima: 2, receitaAdicionalCentavos: 4000, comissaoAdicionalCentavos: 1600 }] }] };

describe("reuniões: cálculos e cenários", () => {
  it("rateia desconto/estorno em centavos conservando a soma e sem atribuir receita ao item de plano zerado", () => {
    expect(ratearCentavos(9999, [5000, 5000, 5000, 0])).toEqual([3333, 3333, 3333, 0]);
    expect(ratearCentavos(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(ratearCentavos(10000, [0, 0])).toEqual([0, 0]);
  });
  it("limita a hipótese à capacidade e usa a comissão/custo cadastrados", () => {
    const servico = { servicoId: "s", nome: "Sobrancelha", precoCentavos: 2000, duracaoMin: 10, custoCentavos: 200, comissaoCentavos: 800, quantidadeMaxima: 2 };
    expect(cenarioDoServico(servico, 10)).toEqual({ quantidade: 2, receitaCentavos: 4000, comissaoCentavos: 1600, margemCentavos: 2000, minutos: 20 });
    expect(cenarioDoServico(servico, -3).receitaCentavos).toBe(0);
    expect(cenarioDoServico({ ...servico, custoCentavos: null }, 1).margemCentavos).toBeNull();
    expect(cenarioDoServico({ ...servico, comissaoCentavos: null }, 1).comissaoCentavos).toBeNull();
  });
  it("zero explícito de custo é diferente de custo ausente", () => {
    expect(cenarioDoServico({ servicoId: "s", nome: "Corte", precoCentavos: 6500, duracaoMin: 30, custoCentavos: 0, comissaoCentavos: 2600, quantidadeMaxima: 1 }, 1).margemCentavos).toBe(3900);
  });
  it("sem base anterior não inventa percentual de crescimento", () => {
    const leituras = leiturasDoPeriodo(indicador, { ...indicador, faturamentoCentavos: 0 });
    expect(leituras.some((l) => l.titulo.includes("cresceu"))).toBe(false);
    expect(leituras.some((l) => l.acao.includes("não uma perda comprovada"))).toBe(true);
  });
  it("combina serviços diferentes sem reutilizar a mesma janela e respeita a limpeza", () => {
    const janela = [{ inicio: "2026-10-28T13:00:00Z", fim: "2026-10-28T14:00:00Z" }];
    const servicos = [
      { servicoId: "corte", nome: "Corte", precoCentavos: 6500, duracaoMin: 30, custoCentavos: 700, comissaoCentavos: 2600, quantidadeMaxima: 1, janelas: janela },
      { servicoId: "sobrancelha", nome: "Sobrancelha", precoCentavos: 2000, duracaoMin: 10, custoCentavos: 200, comissaoCentavos: 800, quantidadeMaxima: 4, janelas: janela },
    ];
    const r = combinarCenarios(servicos, { corte: 1, sobrancelha: 4 }, 5, 5);
    expect(r.quantidades).toEqual({ corte: 1, sobrancelha: 2 });
    expect(r.total.receitaCentavos).toBe(10500);
    expect(r.total.comissaoCentavos).toBe(4200);
    expect(r.naoAlocados).toBe(2);
    expect(r.horarios.map((h) => h.inicio)).toEqual(["2026-10-28T13:00:00.000Z", "2026-10-28T13:35:00.000Z", "2026-10-28T13:50:00.000Z"]);
  });
});

describe("reuniões: proteção de dados no servidor", () => {
  it("apresentação da equipe remove lucro/comissões de todas as seções mesmo para dono", () => {
    const r = protegerSnapshot(snapshot, { equipe: true, lucro: true, comissoes: true });
    expect(r.financeiro).toBeNull();
    expect(r.atual.comissaoCentavos).toBeNull();
    expect(r.anterior.margemCentavos).toBeNull();
    for (const linhas of [r.barbeiros, r.cadeiras, r.servicos]) expect(linhas[0]).toMatchObject({ comissaoCentavos: null, margemCentavos: null });
    expect(r.diaria[0]).toMatchObject({ comissaoAvulsaCentavos: null, comissaoPlanoCentavos: null });
    expect(r.diaria[0].cenarios[0].comissaoAdicionalCentavos).toBeNull();
    expect(r.desempenho).toEqual([]);
    expect(snapshot.atual.comissaoCentavos).toBe(13000);
  });
  it("acesso a lucro sem comissão não permite inferir comissão pela margem", () => {
    const r = protegerSnapshot(snapshot, { equipe: false, lucro: true, comissoes: false });
    expect(r.financeiro?.despesasCentavos).toBe(20000);
    expect(r.atual.margemCentavos).toBeNull();
    expect(r.barbeiros[0].comissaoCentavos).toBeNull();
  });
  it("gestão com permissões mantém os valores originais", () => {
    const r = protegerSnapshot(snapshot, { equipe: false, lucro: true, comissoes: true });
    expect(r.atual).toEqual(indicador);
    expect(r.diaria[0].cenarios[0].comissaoAdicionalCentavos).toBe(1600);
  });
});

describe("reuniões: validação", () => {
  it("recusa datas impossíveis e intervalos excessivos", () => {
    const base = { titulo: "Semanal", tipo: "SEMANAL" };
    expect(criarReuniaoSchema.safeParse({ ...base, inicio: "2026-02-30", fim: "2026-03-01" }).success).toBe(false);
    expect(criarReuniaoSchema.safeParse({ ...base, inicio: "2026-01-01", fim: "2026-10-01" }).success).toBe(false);
    expect(criarReuniaoSchema.safeParse({ ...base, inicio: "2026-10-21", fim: "2026-10-27" }).success).toBe(true);
  });
  it("ignora tentativa de trocar snapshot pelo endpoint de conteúdo e recusa ações duplicadas", () => {
    const a = { id: "acao", texto: "Conferir agenda", barbeiroId: null, responsavel: "Gestão", prazo: "2026-10-29", concluida: false };
    expect(editarReuniaoSchema.parse({ titulo: "Semanal", versao: 1, conteudo: "", acoes: [a], snapshot: { financeiro: 0 } })).not.toHaveProperty("snapshot");
    expect(editarReuniaoSchema.safeParse({ titulo: "Semanal", versao: 1, conteudo: "", acoes: [a, a] }).success).toBe(false);
  });
});
