import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ credito: vi.fn(), criar: vi.fn(), sincronizar: vi.fn(), intento: vi.fn(), existente: vi.fn(), atualizar: vi.fn(), incerta: vi.fn(), gateway: vi.fn() }));
const assinatura = { id: "a", status: "ATIVA", gatewayId: "pixrec_a", gatewayClienteId: "cus_teste", precoCentavos: 11800, plano: { nome: "Corte" }, operacaoInicial: null, pausadaEm: null, encerraEm: null };
const cobranca = { id: "c", assinaturaId: "a", status: "PENDENTE", vencimento: new Date("2026-12-15"), valorCentavos: 9800 };
vi.mock("@/lib/db", () => ({ db: {
  $transaction: async (fn: (tx: unknown) => unknown) => fn({ $executeRaw: vi.fn(), assinatura: { findUniqueOrThrow: async () => assinatura }, alteracaoPlanoAssinatura: { findFirst: async () => null }, emissaoPixMensal: { findUnique: m.intento, create: async () => ({ id: "emissao" }) }, cobranca: { findFirst: m.existente, findUnique: async () => cobranca } }),
  cobranca: { findUniqueOrThrow: async () => cobranca }, emissaoPixMensal: { update: m.atualizar, updateMany: m.incerta },
} }));
vi.mock("@/lib/agenda/carregar", () => ({ configuracao: async () => ({ nomeBarbearia: "Black", toleranciaAtrasoDias: 3 }) }));
vi.mock("@/lib/crescimento/credito-assinatura", () => ({ creditoDoCicloParaPix: m.credito }));
vi.mock("@/lib/assinaturas/cobrancas", () => ({ sincronizarCobranca: m.sincronizar, sincronizarAssinatura: vi.fn(), cobrancaEmAberto: vi.fn() }));
vi.mock("@/lib/pagamentos/gateway", () => ({ gateway: m.gateway, gatewayPorId: m.gateway }));
import { gerarPixDoMes } from "@/lib/assinaturas/cartao-pix";
beforeEach(() => {
  vi.resetAllMocks(); m.intento.mockResolvedValue(null); m.existente.mockResolvedValue(null);
  m.credito.mockResolvedValue({ reservaId: "reserva", abatimentoCentavos: 2000, valorCentavos: 9800 });
  m.gateway.mockResolvedValue({ criarCobrancaPix: m.criar }); m.criar.mockResolvedValue({ id: "ch_teste" });
  m.incerta.mockResolvedValue({ count: 1 });
});
describe("emissão mensal integra crédito sem duplicar cobrança", () => {
  it("cobra somente o restante e confirma o mesmo intento", async () => {
    expect(await gerarPixDoMes("a", "2026-12-15")).toEqual(cobranca);
    expect(m.criar).toHaveBeenCalledWith(expect.objectContaining({ valorCentavos: 9800, referencia: "pixrec_a", vencimento: "2026-12-15" }));
    expect(m.sincronizar).toHaveBeenCalledWith({ id: "ch_teste" });
    expect(m.atualizar).toHaveBeenCalledWith({ where: { id: "emissao" }, data: { estado: "CONFIRMADA", cobrancaId: "c" } });
  });
  it("sem reserva mantém o preço contratado", async () => {
    m.credito.mockResolvedValue(null); await gerarPixDoMes("a", "2026-12-15");
    expect(m.criar).toHaveBeenCalledWith(expect.objectContaining({ valorCentavos: 11800 }));
  });
  it("revisão bloqueia antes de chamar o meio de pagamento", async () => {
    m.credito.mockRejectedValue(new Error("Conferir reserva"));
    await expect(gerarPixDoMes("a", "2026-12-15")).rejects.toThrow("Conferir reserva");
    expect(m.gateway).not.toHaveBeenCalled(); expect(m.criar).not.toHaveBeenCalled();
  });
  it("uma emissão já confirmada retorna a mesma cobrança", async () => {
    m.intento.mockResolvedValue({ estado: "CONFIRMADA", cobrancaId: "c" });
    expect(await gerarPixDoMes("a", "2026-12-15")).toEqual(cobranca);
    expect(m.credito).not.toHaveBeenCalled(); expect(m.criar).not.toHaveBeenCalled();
  });
  it("timeout conserva intento incerto e impede repetição automática", async () => {
    m.criar.mockRejectedValue(new Error("timeout"));
    await expect(gerarPixDoMes("a", "2026-12-15")).rejects.toMatchObject({ codigo: "pix_incerto" });
    expect(m.incerta).toHaveBeenCalledWith({ where: { id: "emissao", estado: "EMITINDO" }, data: { estado: "INCERTA" } });
    m.intento.mockResolvedValue({ estado: "INCERTA" });
    await expect(gerarPixDoMes("a", "2026-12-15")).rejects.toMatchObject({ codigo: "pix_revisao" });
    expect(m.criar).toHaveBeenCalledTimes(1);
  });
});
