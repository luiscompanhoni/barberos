import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ cliente: vi.fn(), servicos: vi.fn() }));
vi.mock("@/lib/auth/sessao", () => ({ exigirCliente: m.cliente }));
vi.mock("@/lib/db", () => ({ db: { servico: { findMany: m.servicos } } }));
vi.mock("@/lib/agenda/carregar", () => ({ configuracao: async () => ({ nomeBarbearia: "Black", janelaAgendamentoDias: 7, prazoCancelamentoMin: 120 }) }));
vi.mock("@/lib/agenda/antecipado", () => ({ antecipadoDisponivel: async () => false }));
vi.mock("@/lib/pagamentos/checkout", () => ({ checkoutProprio: () => false }));
import { GET } from "@/app/api/cliente/servicos/route";
import { ErroNegocio } from "@/lib/erros";
const etiqueta = { texto: "Destaque", cor: "#f9cb30", formato: "PILULA" };
beforeEach(() => {
  vi.clearAllMocks(); m.cliente.mockResolvedValue({ clienteId: "cliente" });
  m.servicos.mockResolvedValue([
    { id: "corte", nome: "Corte", duracaoMin: 40, precoCentavos: 6500, etiquetas: [etiqueta], barbeiros: [{ barbeiro: { id: "b", nome: "Barbeiro", cor: "#FFFFFF", fotoVersao: 0 } }] },
    { id: "barba", nome: "Barba", duracaoMin: 20, precoCentavos: 5000, etiquetas: [{ ...etiqueta, cor: "url(externo)" }], barbeiros: [] },
  ]);
});
describe("catálogo do cliente com etiquetas", () => {
  it("expõe só o contrato validado, sem controles internos de edição", async () => {
    const r = await GET(), dados = await r.json();
    expect(r.status).toBe(200);
    expect(dados.servicos[0].etiquetas).toEqual([{ ...etiqueta, cor: "#F9CB30" }]);
    expect(dados.servicos[1].etiquetas).toEqual([]);
    expect(dados.servicos[0]).not.toHaveProperty("etiquetasVersao");
    expect(m.servicos).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ etiquetas: true }) }));
  });
  it("mantém acesso autenticado antes de consultar serviços", async () => {
    m.cliente.mockRejectedValue(new ErroNegocio("Entre no sistema", 401));
    expect((await GET()).status).toBe(401); expect(m.servicos).not.toHaveBeenCalled();
  });
});
