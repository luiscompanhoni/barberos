import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ planos: vi.fn(), cliente: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { cliente: { findUnique: m.cliente }, plano: { findMany: m.planos }, assinatura: { count: async () => 0 }, expedientePadrao: { findMany: async () => [] } } }));
vi.mock("@/lib/agenda/carregar", () => ({ configuracao: async () => ({ nomeBarbearia: "Black", fuso: "America/Sao_Paulo" }) }));
vi.mock("@/lib/assinaturas/servico", () => ({ vagasRestantes: async () => null, assinar: vi.fn(), entrarNaListaDeEspera: vi.fn(), situacaoDoCliente: vi.fn(), verificarNovaAdesao: vi.fn() }));
vi.mock("@/lib/bot/ferramentas-cancelamento", () => ({ executarCancelamento: vi.fn() }));
import { dadosDaVitrine } from "@/lib/vitrine";
import { executarAssinatura } from "@/lib/bot/ferramentas-assinatura";
beforeEach(() => {
  vi.clearAllMocks(); m.planos.mockResolvedValue([{ id: "business", nome: "Business", precoCentavos: 9700, visivel: true, compravel: true, vendaSomenteEquipe: true, etiquetas: [], intervaloMinDias: null, diasSemana: [1, 2, 3], descontoExtrasPct: 10, formasPagamento: ["PIX"], vagas: null, maxAgendamentosAbertos: 1, servicos: [] }]);
});
afterEach(() => vi.unstubAllEnvs());
describe("Business visível com contratação na recepção", () => {
  it("mantém preço e plano na vitrine sem oferecer compra autônoma", async () => {
    const v = await dadosDaVitrine();
    expect(v.planos).toHaveLength(1); expect(v.planos[0]).toMatchObject({ id: "business", precoCentavos: 9700, compravel: false });
    expect(m.planos.mock.calls[0][0].where).toEqual({ ativo: true, visivel: true });
  });
  it("bot pode explicar o Business e encaminha contratação para a equipe", async () => {
    const r = await executarAssinatura("listar_planos", {}, { conversaId: "conversa", telefone: "teste", nomePerfil: null });
    const p = JSON.parse(r.texto)[0];
    expect(p.nome).toBe("Business"); expect(p.disponivel_para_compra).toBe(false); expect(p.venda_somente_equipe).toBe(true);
    expect(p.condicoes).toContain("recepção");
  });
  it("oferece o plano oculto somente para o cliente nominal durante a homologação", async () => {
    vi.stubEnv("ASSINATURA_TESTE_CLIENTE_ID", "titular");
    vi.stubEnv("ASSINATURA_TESTE_PLANO_ID", "interno");
    vi.stubEnv("ASSINATURA_TESTE_ATE", "2099-01-01T00:00:00Z");
    m.cliente.mockResolvedValue({ id: "outro", excluidoEm: null });
    await executarAssinatura("listar_planos", {}, { conversaId: "c", telefone: "outro", nomePerfil: null });
    expect(m.planos.mock.lastCall?.[0].where).toEqual({ ativo: true, visivel: true });
    m.cliente.mockResolvedValue({ id: "titular", excluidoEm: null });
    await executarAssinatura("listar_planos", {}, { conversaId: "c", telefone: "titular", nomePerfil: null });
    expect(m.planos.mock.lastCall?.[0].where).toEqual({ ativo: true, OR: [{ visivel: true }, { id: "interno", visivel: false, precoCentavos: 100 }] });
    m.cliente.mockResolvedValue({ id: "titular", excluidoEm: new Date() });
    await executarAssinatura("listar_planos", {}, { conversaId: "c", telefone: "titular", nomePerfil: null });
    expect(m.planos.mock.lastCall?.[0].where).toEqual({ ativo: true, visivel: true });
  });
});
