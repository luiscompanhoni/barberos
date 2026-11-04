import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assinatura: vi.fn(), cobranca: vi.fn(), atual: vi.fn(), piloto: vi.fn(), notificar: vi.fn(), mensagem: vi.fn(), reservar: vi.fn(), concluir: vi.fn(), revisar: vi.fn(), buscarGateway: vi.fn(), configuracao: vi.fn(), gatewayConfere: vi.fn(), confirmar: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { assinatura: { findUniqueOrThrow: mocks.assinatura }, cobranca: { findFirst: mocks.cobranca, findUnique: mocks.atual }, mensagem: { findUnique: mocks.mensagem }, configuracao: { findUnique: mocks.configuracao } } }));
vi.mock("@/lib/whatsapp/piloto", () => ({ reservarEnvioPiloto: mocks.piloto }));
vi.mock("@/lib/whatsapp/conversas", () => ({ notificarCliente: mocks.notificar, notificarEmSegundoPlano: vi.fn() }));
vi.mock("@/lib/dominios", () => ({ urlSite: () => "https://exemplo.invalid" }));
vi.mock("@/lib/assinaturas/cobranca-automatica", () => ({ reservarCobrancaManual: mocks.reservar, concluirCobrancaManual: mocks.concluir, revisarCobrancaManual: mocks.revisar, gatewayConfere: mocks.gatewayConfere, confirmarAntesDoEnvio: mocks.confirmar }));
vi.mock("@/lib/pagamentos/gateway", () => ({ gatewayPorId: async () => ({ buscarCobranca: mocks.buscarGateway }) }));

import { cobrarPeloWhatsApp } from "@/lib/assinaturas/cobrancas";

const cobranca = { id: "c1", gatewayId: "gateway-1", forma: "PIX", link: "/c/pagar/token-1", tokenPublico: "token-1", valorCentavos: 10000, vencimento: new Date("2026-11-01T00:00:00Z"), expiraEm: new Date("2099-01-01T00:00:00Z") };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.assinatura.mockResolvedValue({ status: "ATIVA", cliente: { nome: "Teste", telefone: "00000000000", aceitaMensagens: true }, plano: { nome: "Plano" } });
  mocks.cobranca.mockResolvedValue(cobranca);
  mocks.atual.mockResolvedValue({ status: "PENDENTE" });
  mocks.piloto.mockResolvedValue(undefined);
  mocks.notificar.mockResolvedValue({ ok: true, erro: null, mensagemId: "m1" });
  mocks.mensagem.mockResolvedValue({ wamid: "provedor-1" });
  mocks.reservar.mockResolvedValue({ id: "t1", snapshot: { telefone: "00000000000", link: "/c/pagar/token-1", valorCentavos: 10000, vencimento: "2026-11-01" } });
  mocks.gatewayConfere.mockReturnValue(true);
  mocks.confirmar.mockResolvedValue(true);
  mocks.concluir.mockImplementation(async (_id, wamid) => wamid ? "ACEITA" : "INCERTA");
  mocks.buscarGateway.mockResolvedValue({ id: "gateway-1", status: "PENDENTE", pagaEm: null, valorCentavos: 10000, vencimento: "2026-11-01", expiraEm: "2099-01-01T00:00:00Z" });
  mocks.configuracao.mockResolvedValue({ fuso: "America/Sao_Paulo" });
});

describe("atalho de cobrança no WhatsApp", () => {
  it("não renova Pix nem envia quando o piloto bloqueia", async () => {
    mocks.piloto.mockRejectedValueOnce(new Error("Envio bloqueado"));
    await expect(cobrarPeloWhatsApp("a1")).rejects.toThrow("Envio bloqueado");
    expect(mocks.notificar).not.toHaveBeenCalled();
  });

  it("não gera novo Pix nem envia link expirado", async () => {
    mocks.cobranca.mockResolvedValueOnce({ ...cobranca, expiraEm: new Date(0) });
    expect((await cobrarPeloWhatsApp("a1")).enviado).toBe(false);
    expect(mocks.notificar).not.toHaveBeenCalled();
  });
  it("não envia boleto vencido sem revisão", async () => {
    mocks.cobranca.mockResolvedValueOnce({ ...cobranca, forma: "BOLETO", vencimento: new Date("2000-01-01T00:00:00Z") });
    expect((await cobrarPeloWhatsApp("a1")).enviado).toBe(false);
    expect(mocks.notificar).not.toHaveBeenCalled();
  });

  it("não informa sucesso se o canal falhou", async () => {
    mocks.notificar.mockResolvedValueOnce({ ok: false, erro: "Canal indisponível" });
    await expect(cobrarPeloWhatsApp("a1")).resolves.toEqual({ enviado: false, motivo: expect.stringContaining("Canal indisponível") });
    expect(mocks.concluir).toHaveBeenCalledWith("t1", null);
  });

  it("não envia se a cobrança foi paga enquanto preparava o link", async () => {
    mocks.atual.mockResolvedValueOnce({ status: "PAGA" });
    expect((await cobrarPeloWhatsApp("a1")).enviado).toBe(false);
    expect(mocks.notificar).not.toHaveBeenCalled();
  });

  it("encaminha somente a cobrança em aberto com link válido", async () => {
    await expect(cobrarPeloWhatsApp("a1")).resolves.toEqual({ enviado: true });
    expect(mocks.notificar).toHaveBeenCalledWith(expect.any(String), expect.stringContaining("https://exemplo.invalid/c/pagar/token-1"));
  });
  it("não reenvia quando já existe tentativa ou o estado é incerto", async () => {
    mocks.reservar.mockResolvedValueOnce(null);
    expect((await cobrarPeloWhatsApp("a1")).enviado).toBe(false);
    expect(mocks.notificar).not.toHaveBeenCalled();
  });
  it("não envia quando o gateway já confirma pagamento", async () => {
    mocks.buscarGateway.mockResolvedValueOnce({ id: "gateway-1", status: "PAGA", pagaEm: "2026-11-02", valorCentavos: 10000, vencimento: "2026-11-01" });
    mocks.gatewayConfere.mockReturnValueOnce(false);
    expect((await cobrarPeloWhatsApp("a1")).enviado).toBe(false);
    expect(mocks.revisar).toHaveBeenCalledWith("t1");
    expect(mocks.notificar).not.toHaveBeenCalled();
  });
  it("respeita o opt-out antes de consultar ou enviar", async () => {
    mocks.assinatura.mockResolvedValueOnce({ status: "ATIVA", cliente: { nome: "Teste", telefone: "00000000000", aceitaMensagens: false }, plano: { nome: "Plano" } });
    expect((await cobrarPeloWhatsApp("a1")).enviado).toBe(false);
    expect(mocks.buscarGateway).not.toHaveBeenCalled(); expect(mocks.notificar).not.toHaveBeenCalled();
  });
});
