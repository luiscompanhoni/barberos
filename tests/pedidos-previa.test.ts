import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErroNegocio } from "@/lib/erros";
const m = vi.hoisted(() => ({ pedido: vi.fn(), profissional: vi.fn(), servico: vi.fn(), preco: vi.fn(), sessao: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { pedidoAgendamento: { findUnique: m.pedido }, barbeiro: { findFirst: m.profissional } } }));
vi.mock("@/lib/auth/sessao", () => ({ BALCAO: ["DONO", "GERENTE", "RECEPCAO"], exigirSessao: m.sessao }));
vi.mock("@/lib/agenda/carregar", () => ({ configuracao: async () => ({ antecedenciaMinimaMin: 30, janelaAgendamentoDias: 30, fuso: "America/Sao_Paulo" }), servicoDoBarbeiro: m.servico }));
vi.mock("@/lib/assinaturas/agenda", () => ({ precificar: m.preco }));
import { previaPedido } from "@/lib/agenda/pedidos-previa";
import { GET } from "@/app/api/pedidos-agendamento/previa/route";
const inicio = new Date("2026-11-06T13:00Z");
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-04T12:00Z"));
  m.pedido.mockResolvedValue({ id: "p", status: "PENDENTE", clienteId: "c", cliente: { excluidoEm: null }, barbeiroId: "b", servicoIds: ["corte", "barba"] });
  m.profissional.mockResolvedValue({ nome: "Profissional" });
  m.servico.mockImplementation(async (_b: string, id: string) => ({ servico: { nome: id }, duracaoMin: 45, minimoDuracaoMin: 10, precoCentavos: id === "corte" ? 6000 : 4000 }));
  m.preco.mockImplementation(async (p: { precoBase: number }) => ({ precoCentavos: p.precoBase, assinaturaId: null }));
  m.sessao.mockResolvedValue({ papel: "RECEPCAO" });
});
afterEach(() => vi.useRealTimers());

describe("prévia real do pedido antes de conferir a agenda externa", () => {
  it("soma overrides do profissional e mostra o término completo", async () => {
    const p = await previaPedido("p", "b", inicio);
    expect(p).toMatchObject({ duracaoMin: 90, precoCentavos: 10000, fim: "2026-11-06T14:30:00.000Z", requerAvulso: false });
    expect(p.itens.map(i => i.duracaoMin)).toEqual([45, 45]);
    expect(m.preco).toHaveBeenNthCalledWith(2, expect.objectContaining({ inicio: +inicio + 45 * 60000, precoBase: 4000 }));
  });
  it("considera usos anteriores do mesmo grupo e pede aceite para regra avulsa", async () => {
    m.preco.mockResolvedValueOnce({ precoCentavos: 0, assinaturaId: "a" }).mockRejectedValueOnce(new ErroNegocio("Regra do plano; confirme avulso.", 422, "regra_plano", { precoAvulso: 3600 }));
    const p = await previaPedido("p", "b", inicio);
    expect(p).toMatchObject({ precoCentavos: 3600, requerAvulso: true });
    expect(p.itens[0].peloPlano).toBe(true); expect(p.itens[1].peloPlano).toBe(false);
    expect(p.itens[1].regraPlano).toContain("confirme avulso");
    expect(m.preco).toHaveBeenNthCalledWith(2, expect.objectContaining({ usosExtras: [expect.objectContaining({ servicoId: "corte", inicio: +inicio })] }));
  });
  it("não disfarça falha técnica de precificação como valor avulso", async () => {
    m.preco.mockRejectedValue(new Error("banco indisponível"));
    await expect(previaPedido("p", "b", inicio)).rejects.toThrow("banco indisponível");
  });
  it("recusa pedido decidido e profissional diferente do solicitado", async () => {
    await expect(previaPedido("p", "outro", inicio)).rejects.toMatchObject({ codigo: "pedido_alterado" });
    m.pedido.mockResolvedValue({ status: "CANCELADO", cliente: { excluidoEm: null } });
    await expect(previaPedido("p", "b", inicio)).rejects.toMatchObject({ codigo: "pedido_decidido" });
    expect(m.preco).not.toHaveBeenCalled();
  });
  it("rota exige equipe do balcão antes de consultar dados", async () => {
    m.sessao.mockRejectedValue(new ErroNegocio("Sem acesso", 403));
    const r = await GET(new Request("https://painel.test/api/pedidos-agendamento/previa?id=p&barbeiroId=b&inicio=2026-11-06T13:00:00Z"));
    expect(r.status).toBe(403); expect(m.pedido).not.toHaveBeenCalled();
  });
  it("resposta da rota é privada e não cria reservas nem usa provedores", async () => {
    const r = await GET(new Request("https://painel.test/api/pedidos-agendamento/previa?id=p&barbeiroId=b&inicio=2026-11-06T13:00:00Z"));
    expect(r.status).toBe(200); expect(r.headers.get("Cache-Control")).toContain("no-store");
    expect(await r.json()).toMatchObject({ precoCentavos: 10000, duracaoMin: 90 });
  });
});
