import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Sessao } from "@/lib/auth/sessao";

const m = vi.hoisted(() => ({ versao: vi.fn(), raw: vi.fn(), extrasRaw: vi.fn(), futuraPct: 9000 }));
vi.mock("@/lib/db", () => ({ db: {
  remuneracaoVersao: { findFirst: m.versao }, comissaoServico: { findMany: m.raw },
  poteConfig: { findUnique: m.extrasRaw }, poteFicha: { findMany: async () => [] }, comissaoProdutoFaixa: { findMany: async () => [] },
  barbeiro: { findMany: async () => [{ id: "barbeiro", nome: "Barbeiro fictício" }] },
  servico: { findMany: async () => [{ id: "corte", custoCentavos: 500 }] },
  agendamento: { findMany: async () => [false, true].map(plano => ({
    id: plano ? "plano" : "avulso", clienteId: plano ? "cliente-plano" : "cliente-avulso", inicio: new Date("2026-12-01T01:00:00Z"), fim: new Date("2026-12-01T01:30:00Z"),
    status: "CONFIRMADO", assinaturaId: plano ? "assinatura-ficticia" : null, precoCentavos: plano ? 0 : 10000, servicoId: "corte", cliente: { nome: "Cliente fictício" }, servico: { nome: "Corte", precoCentavos: 10000 },
  })) },
} }));
vi.mock("@/lib/agenda/carregar", () => ({
  configuracao: async () => ({ fuso: "America/Sao_Paulo", granularidadeMin: 15, intervaloEntreClientes: 0 }),
  limitesDoDia: (data: string) => ({ inicio: Date.parse(`${data}T00:00:00-03:00`), fim: Date.parse(`${data}T00:00:00-03:00`) + 86400000 }),
}));
vi.mock("@/lib/agenda/encaixes", () => ({ encaixesDoDia: async () => ({ profissionais: [{ barbeiroId: "barbeiro", servicos: [{ servicoId: "corte", nome: "Corte", precoCentavos: 10000, duracaoMin: 30, quantidade: 1, janelas: [] }] }] }) }));
vi.mock("@/lib/auth/permissoes", () => ({ permissoesDoUsuario: async () => ({ reunioes: false, comissoes_equipe: false, lucro: false }) }));
vi.mock("@/lib/recompras/servico", () => ({ oportunidadesDoDia: async () => [] }));
vi.mock("@/lib/reunioes/acoes", () => ({ acoesDoBarbeiro: async () => [] }));
vi.mock("@/lib/rh/adicionais", () => ({ adicionaisDoCalculo: async () => [], listarAdicionais: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ auditar: vi.fn() }));
import { carregarMeuDia } from "@/lib/reunioes/meu-dia";

const regra = (pct: number) => [{ servicoId: "corte", barbeiroId: null, avulsoTipo: "PERCENTUAL", avulsoValor: pct, planoTipo: "FIXO", planoValor: 1500 }];
const extras = (ativo: boolean) => ({ assinaturas: { ativo, percentualBps: 3500, creditos: { corte: 1 } }, faixas: [] });
const s: Sessao = { usuarioId: "usuario", papel: "BARBEIRO", nome: "Teste", barbeiroId: "barbeiro", clienteId: null };
beforeEach(() => {
  vi.clearAllMocks(); m.futuraPct = 9000;
  m.raw.mockImplementation(async () => regra(m.futuraPct)); m.extrasRaw.mockResolvedValue({ ativo: true, percentualBps: 9900 });
  m.versao.mockImplementation(async ({ where }: { where: { escopo: string; competencia: { lte: string } } }) => ({
    competencia: where.competencia.lte, versao: 1,
    conteudoJson: { origem: "CONFIGURACAO_EXPLICITA", conteudo: where.escopo === "servicos" ? regra(where.competencia.lte < "2026-12" ? 4000 : 7000) : extras(where.competencia.lte >= "2026-12") },
  }));
});

describe("Meu dia usa as regras do atendimento", () => {
  it("versão futura física não altera projeção de novembro nem liga o pote antes da vigência", async () => {
    const r = await carregarMeuDia(s, { data: "2026-11-30" });
    expect(r.resumo).toMatchObject({ comissaoAvulsaCentavos: 4000, comissaoPlanoCentavos: 1500, planoPendente: false });
    expect(r.servicos[0].comissaoCentavos).toBe(4000);
    m.futuraPct = 9900;
    expect((await carregarMeuDia(s, { data: "2026-11-30" })).resumo).toEqual(r.resumo);
    expect(m.raw).not.toHaveBeenCalled(); expect(m.extrasRaw).not.toHaveBeenCalled();
    expect(m.versao.mock.calls.every(([q]) => q.where.competencia.lte === "2026-11")).toBe(true);
  });
});
