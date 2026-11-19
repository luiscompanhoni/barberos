import { afterEach, describe, expect, it, vi } from "vitest";
import { assinaturaTesteUnico, autorizaOfertaTeste, ofertaTesteVenda, planoReservadoParaTeste } from "@/lib/assinaturas/teste-venda";

afterEach(() => vi.unstubAllEnvs());
function configurar() {
  vi.stubEnv("ASSINATURA_TESTE_CLIENTE_ID", "cliente-interno");
  vi.stubEnv("ASSINATURA_TESTE_PLANO_ID", "plano-interno");
  vi.stubEnv("ASSINATURA_TESTE_ATE", "2030-01-02T12:00:00Z");
}
describe("venda nominal de homologação", () => {
  it("fica inerte sem configuração completa e exige prazo válido para nova oferta", () => {
    expect(ofertaTesteVenda()).toBeNull();
    configurar();
    expect(ofertaTesteVenda(Date.parse("2030-01-02T11:59:59Z"))).toEqual({ clienteId: "cliente-interno", planoId: "plano-interno" });
    expect(ofertaTesteVenda(Date.parse("2030-01-02T12:00:00Z"))).toBeNull();
    vi.stubEnv("ASSINATURA_TESTE_ATE", "inválido");
    expect(ofertaTesteVenda()).toBeNull();
  });
  it("reserva o plano para o titular e limita a condição ao snapshot de R$ 1", () => {
    configurar();
    const a = { clienteId: "cliente-interno", planoId: "plano-interno", precoCentavos: 100 };
    expect(assinaturaTesteUnico(a)).toBe(true);
    expect(assinaturaTesteUnico({ ...a, clienteId: "outro" })).toBe(false);
    expect(assinaturaTesteUnico({ ...a, planoId: "normal" })).toBe(false);
    expect(assinaturaTesteUnico({ ...a, precoCentavos: 11800 })).toBe(false);
    expect(planoReservadoParaTeste("plano-interno")).toBe(true);
    expect(planoReservadoParaTeste("normal")).toBe(false);
  });
  it("preserva o limite de renovação para uma compra já criada após expirar a oferta", () => {
    configurar();
    vi.stubEnv("ASSINATURA_TESTE_ATE", "2020-01-01T00:00:00Z");
    expect(ofertaTesteVenda()).toBeNull();
    expect(assinaturaTesteUnico({ clienteId: "cliente-interno", planoId: "plano-interno", precoCentavos: 100 })).toBe(true);
    expect(planoReservadoParaTeste("plano-interno")).toBe(true);
  });
  it("nega adesão do site, de outro cliente, com preço alterado ou plano exposto na vitrine", () => {
    configurar(); vi.stubEnv("ASSINATURA_TESTE_ATE", "2099-01-01T00:00:00Z");
    const plano = { id: "plano-interno", precoCentavos: 100, visivel: false };
    expect(autorizaOfertaTeste(plano, "BOT", "cliente-interno")).toBe(true);
    expect(autorizaOfertaTeste(plano, "SITE", "cliente-interno")).toBe(false);
    expect(autorizaOfertaTeste(plano, "PAINEL", "cliente-interno")).toBe(false);
    expect(autorizaOfertaTeste(plano, "BOT", "outro")).toBe(false);
    expect(autorizaOfertaTeste({ ...plano, precoCentavos: 11800 }, "BOT", "cliente-interno")).toBe(false);
    expect(autorizaOfertaTeste({ ...plano, visivel: true }, "BOT", "cliente-interno")).toBe(false);
  });
});
