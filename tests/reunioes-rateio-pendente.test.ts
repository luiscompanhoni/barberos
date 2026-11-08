import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Sessao } from "@/lib/auth/sessao";

const m = vi.hoisted(() => ({
  agendamentos: vi.fn(), comandas: vi.fn(), comissoes: vi.fn(), reuniao: vi.fn(), permissoes: vi.fn(),
  pendentes: new Set<string>(),
}));
vi.mock("@/lib/db", () => ({ db: {
  agendamento: { findMany: m.agendamentos }, comanda: { findMany: m.comandas },
  pedidoEstorno: { findMany: async () => [] }, barbeiro: { findMany: async () => [] },
  reuniao: { findUnique: m.reuniao },
} }));
vi.mock("@/lib/agenda/carregar", () => ({ configuracao: async () => ({ fuso: "America/Sao_Paulo" }) }));
vi.mock("@/lib/financeiro/recebimentos", () => ({ recebimentosMensalidades: async () => ({ total: 10000, pendentes: [] }) }));
vi.mock("@/lib/indicadores/ocupacao", () => ({ ocupacaoDosDias: async () => ({ total: { taxa: .5, capacidadeMin: 120, ocupadoMin: 60 } }) }));
vi.mock("@/lib/rh/comissoes", () => ({ relatorioComissoes: m.comissoes }));
vi.mock("@/lib/auth/permissoes", () => ({ permissoesDoUsuario: m.permissoes }));
vi.mock("@/lib/auditoria", () => ({ auditar: vi.fn() }));
vi.mock("@/lib/financeiro/resumo", () => ({ resumoMes: async () => ({ mes: "2026-11", receitas: { total: 10000 }, despesas: { total: 1000 }, resultado: 9000 }) }));
vi.mock("@/lib/avaliacoes/resumos", () => ({ resumosPublicados: async () => [] }));
vi.mock("@/lib/desempenho/consultas", () => ({ resumoDesempenhoPeriodo: vi.fn() }));
vi.mock("@/lib/reunioes/meu-dia", () => ({ carregarMeuDia: vi.fn() }));

import { dadosDoPeriodo } from "@/lib/reunioes/dados";
import { lerReuniao, montarSnapshot } from "@/lib/reunioes/servico";

const dono: Sessao = { usuarioId: "dono", papel: "DONO", nome: "Dono fictício", barbeiroId: null, clienteId: null };
const data = "2026-11-08";

function agendamentos(inicio: Date) {
  const momento = new Date(inicio.getTime() + 9 * 3600000);
  const base = { status: "CONCLUIDO", inicio: momento };
  return [
    { ...base, id: "at-plano", clienteId: "cliente-plano", barbeiroId: "b-plano", servicoId: "s-plano", cadeiraId: "c-plano", assinaturaId: "assinatura",
      precoCentavos: 0, barbeiro: { nome: "Profissional plano" }, servico: { nome: "Serviço plano", custoCentavos: 100 }, cadeira: { nome: "Cadeira plano" }, itemComanda: null },
    { ...base, id: "at-avulso", clienteId: "cliente-avulso", barbeiroId: "b-avulso", servicoId: "s-avulso", cadeiraId: "c-avulso", assinaturaId: null,
      precoCentavos: 5000, barbeiro: { nome: "Profissional avulso" }, servico: { nome: "Serviço avulso", custoCentavos: 200 }, cadeira: { nome: "Cadeira avulso" }, itemComanda: { comanda: { status: "FECHADA", fechadaEm: momento } } },
  ];
}

function relatorio(pendente: boolean) {
  return {
    assinaturas: {
      creditosPorServico: { "s-plano": 40 },
      conciliacao: { pendente, metodo: "MAIORES_RESTOS_V1", motivos: ["MOTIVO-PRIVADO-DO-RH"],
        ordemDesempate: ["ID-PRIVADO-DO-DIAGNOSTICO"], detalhes: [{ barbeiroId: "ID-PRIVADO-DO-DIAGNOSTICO", finalQuotaNumerador: "123456789012345" }] },
    },
    barbeiros: [
      { barbeiroId: "b-plano", nome: "Profissional plano", semRegra: 0, avulso: { base: 0 },
        assinaturas: { comissao: 3500, receitaAtribuida: 10000 }, produtos: null,
        atendimentos: [{ id: "at-plano", comissao: 0, regra: "Comissão das assinaturas" }] },
      { barbeiroId: "b-avulso", nome: "Profissional avulso", semRegra: 0, avulso: { base: 5000 }, assinaturas: null, produtos: null,
        atendimentos: [{ id: "at-avulso", comissao: 2000, regra: "40% do valor" }] },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.pendentes = new Set([data]);
  m.permissoes.mockResolvedValue({ reunioes: true, lucro: true, comissoes_equipe: true });
  m.agendamentos.mockImplementation(async ({ where }: { where: { clienteId?: unknown; inicio: { gte: Date } } }) => where.clienteId ? [] : agendamentos(where.inicio.gte));
  m.comandas.mockImplementation(async ({ where }: { where: { fechadaEm: { gte: Date } } }) => {
    const a = agendamentos(where.fechadaEm.gte)[1];
    return [{ descontoCentavos: 0, pagamentos: [{ forma: "PIX", valorCentavos: 5000, status: "PAGO" }],
      itens: [{ quantidade: 1, precoUnitCentavos: 5000, descricao: "Serviço avulso", produtoId: null, produto: null, barbeiroId: a.barbeiroId, agendamento: a }] }];
  });
  m.comissoes.mockImplementation(async (inicio: string) => relatorio(m.pendentes.has(inicio)));
});

const semDiagnosticoPrivado = (v: unknown) => {
  const json = JSON.stringify(v);
  for (const reservado of ["ID-PRIVADO-DO-DIAGNOSTICO", "MOTIVO-PRIVADO-DO-RH", "123456789012345", "finalQuotaNumerador", "ordemDesempate", "\"conciliacao\""]) {
    expect(json).not.toContain(reservado);
  }
};

describe("Reuniões respeitam o rateio pendente sem revelar detalhes do RH", () => {
  it("anula comissão/margem no total e nos grupos de plano e preserva todos os grupos avulsos", async () => {
    const r = await dadosDoPeriodo(data, data);
    expect(r.rateioAssinaturasPendente).toBe(true);
    expect(r.atual).toMatchObject({ comissaoCentavos: null, margemCentavos: null, faturamentoCentavos: 15000 });
    for (const grupos of [r.barbeiros, r.servicos, r.cadeiras]) {
      const plano = grupos.find(g => g.id.endsWith("plano"));
      const avulso = grupos.find(g => g.id.endsWith("avulso"));
      expect(plano).toMatchObject({ comissaoCentavos: null, margemCentavos: null });
      expect(avulso).toMatchObject({ comissaoCentavos: 2000, margemCentavos: 2800 });
    }
    semDiagnosticoPrivado(r);
  });

  it("com o rateio conciliado mantém os valores normais de comissão e margem", async () => {
    m.pendentes.clear();
    const r = await dadosDoPeriodo(data, data);
    expect(r.rateioAssinaturasPendente).toBe(false);
    expect(r.atual).toMatchObject({ comissaoCentavos: 5500, margemCentavos: 9200 });
    for (const grupos of [r.barbeiros, r.servicos, r.cadeiras]) {
      expect(grupos.find(g => g.id.endsWith("plano"))).toMatchObject({ comissaoCentavos: 3500, margemCentavos: 6400 });
      expect(grupos.find(g => g.id.endsWith("avulso"))).toMatchObject({ comissaoCentavos: 2000, margemCentavos: 2800 });
    }
    semDiagnosticoPrivado(r);
  });

  it("publica apenas aviso genérico no snapshot e sinaliza separadamente o período anterior", async () => {
    const atual = await montarSnapshot(data, data, "SEMANAL", dono);
    expect(atual.atual.comissaoCentavos).toBeNull();
    expect(atual.anterior.comissaoCentavos).toBe(5500);
    expect(atual.avisos.some(a => a.includes("deste período está pendente"))).toBe(true);
    expect(atual.avisos.some(a => a.includes("período anterior está pendente"))).toBe(false);
    semDiagnosticoPrivado(atual);

    m.pendentes = new Set(["2026-11-07"]);
    const anterior = await montarSnapshot(data, data, "SEMANAL", dono);
    expect(anterior.atual.comissaoCentavos).toBe(5500);
    expect(anterior.anterior.comissaoCentavos).toBeNull();
    expect(anterior.avisos.some(a => a.includes("deste período está pendente"))).toBe(false);
    expect(anterior.avisos.some(a => a.includes("período anterior está pendente"))).toBe(true);
    semDiagnosticoPrivado(anterior);
  });

  it("não recalcula nem modifica um retrato existente ao mudar o rateio atual e preserva a proteção da equipe", async () => {
    m.pendentes.clear();
    const snapshot = await montarSnapshot(data, data, "SEMANAL", dono);
    const congelado = JSON.stringify(snapshot);
    m.reuniao.mockResolvedValue({ id: "reuniao", titulo: "Retrato existente", tipo: "SEMANAL", inicio: data, fim: data, versao: 1,
      criadoEm: new Date("2026-11-08T12:00:00Z"), criadoPorId: dono.usuarioId, conteudo: "", acoes: [], snapshot });
    m.comissoes.mockClear(); m.pendentes.add(data);
    const gestao = await lerReuniao(dono, "reuniao");
    expect(gestao.snapshot).toEqual(snapshot);
    expect(gestao.snapshot.atual.comissaoCentavos).toBe(5500);
    const equipe = await lerReuniao(dono, "reuniao", true);
    expect(equipe.snapshot.atual).toMatchObject({ comissaoCentavos: null, margemCentavos: null });
    for (const grupos of [equipe.snapshot.barbeiros, equipe.snapshot.servicos, equipe.snapshot.cadeiras]) {
      expect(grupos.every(g => g.comissaoCentavos === null && g.margemCentavos === null)).toBe(true);
    }
    expect(JSON.stringify(snapshot)).toBe(congelado);
    expect(m.comissoes).not.toHaveBeenCalled();
    semDiagnosticoPrivado(equipe);
  });
});
