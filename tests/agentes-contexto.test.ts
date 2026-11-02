import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  campanhas: vi.fn(async () => [{ id: "c1", nome: "Retorno", status: "ATIVA", limiteDiario: 50 }]),
  projetos: vi.fn(async () => []),
}));
vi.mock("@/lib/db", () => ({ db: {
  servico: { findMany: async () => [] }, cliente: { groupBy: async () => [] },
  campanha: { findMany: mocks.campanhas }, estudioProjeto: { findMany: mocks.projetos },
  despesa: { aggregate: async () => ({ _count: 0, _sum: { valorCentavos: null } }) }, cobranca: { groupBy: async () => [] },
} }));
vi.mock("@/lib/agenda/carregar", () => ({ configuracao: async () => ({ nomeBarbearia: "Black", fuso: "America/Sao_Paulo", endereco: "Endereço comercial" }) }));
vi.mock("@/lib/campanhas/capacidade", () => ({ capacidadeDaAgenda: async () => ({ hoje: "2026-11-01", horizontes: [], servico: {} }) }));
vi.mock("@/lib/indicadores/periodo", () => ({ resolverPeriodo: () => ({ de: 1, ate: 2 }) }));
vi.mock("@/lib/indicadores/negocio", () => ({ indicadoresDoNegocio: async () => ({
  atual: { receita: { total: 0 } }, anterior: {}, agenda: {},
  clientes: { novos: 0, origens: {}, frequencia: {}, retorno: {}, top: [{ nome: "NOME_PRIVADO", id: "ID_PRIVADO" }], idade: { dado: "IDADE_PRIVADA" } },
  indicacoes: { novas: 0, convertidas: 0, top: [{ nome: "INDICADOR_PRIVADO" }] },
}) }));
vi.mock("@/lib/agentes/integracoes", () => ({ integracoesAgentes: () => [] }));
vi.mock("@/lib/agentes/meta", () => ({ configurarMeta: () => ({ disponivel: false }) }));
import { contextoAgente } from "@/lib/agentes/contexto";

afterEach(() => vi.clearAllMocks());
describe("contexto por especialidade", () => {
  it("identifica limite de campanha como mensagens WhatsApp, não orçamento Meta", async () => {
    const c = await contextoAgente("trafego", "dono-1");
    expect(c.fontes.find(f => f.nome === "campanhas")?.dados).toMatchObject({ canal: "WHATSAPP", unidadeLimiteDiario: "mensagens", campanhas: [{ limiteDiario: 50 }] });
    expect(mocks.projetos).toHaveBeenCalledWith(expect.objectContaining({ where: { usuarioId: "dono-1" } }));
  });
  it("retira rankings nominais e dados demográficos do contexto do modelo", async () => {
    const c = await contextoAgente("dados", "dono-1");
    expect(JSON.stringify(c)).not.toContain("PRIVAD");
    expect(c.fontes.find(f => f.nome.startsWith("Indicadores"))?.dados).toMatchObject({ periodo: { de: 1, ate: 2 }, fuso: "America/Sao_Paulo" });
  });
});
