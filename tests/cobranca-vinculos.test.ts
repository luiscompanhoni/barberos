import { afterEach, describe, expect, it } from "vitest";
import { gatewayConfere, type SnapshotCobranca } from "@/lib/assinaturas/cobranca-automatica";
import { linkPermitido } from "@/lib/assinaturas/cobranca-automatica-regras";
import type { CobrancaGateway } from "@/lib/pagamentos/gateway";

const agora = new Date("2031-04-15T15:00:00Z");
const local: SnapshotCobranca = { cobrancaId: "c", gatewayId: "g", assinaturaGatewayId: "sub-1", status: "PENDENTE", forma: "CARTAO", link: "/c/pagar/token-certo", tokenPublico: "token-certo", valorCentavos: 10000, vencimento: "2031-04-14", expiraEm: null, clienteId: "cliente", telefone: "47" };
const remoto: CobrancaGateway = { id: "g", assinaturaGatewayId: "sub-1", forma: "CARTAO", status: "PENDENTE", abertaConfirmada: true, pagaEm: null, valorCentavos: 10000, vencimento: "2031-04-14", vencimentoConfirmado: true, link: null };
afterEach(() => { delete process.env.COBRANCA_AUTOMATICA_LINK_HOSTS; });

describe("verificação do link e vínculo da cobrança", () => {
  it("aceita apenas o token interno da própria cobrança", () => {
    expect(linkPermitido("/c/pagar/token-certo", "token-certo")).toBe(true);
    expect(linkPermitido("/c/pagar/outro-token", "token-certo")).toBe(false);
    expect(gatewayConfere({ ...local, link: "/c/pagar/outro-token" }, remoto, agora)).toBe(false);
  });
  it("exige domínio externo autorizado e link remoto idêntico", () => {
    process.env.COBRANCA_AUTOMATICA_LINK_HOSTS = "checkout.example";
    const externo = { ...local, link: "https://checkout.example/pagar/1" };
    expect(gatewayConfere(externo, { ...remoto, link: externo.link }, agora)).toBe(true);
    expect(gatewayConfere(externo, { ...remoto, link: "https://checkout.example/pagar/2" }, agora)).toBe(false);
    expect(gatewayConfere({ ...externo, link: "https://golpe.example/pagar/1" }, { ...remoto, link: "https://golpe.example/pagar/1" }, agora)).toBe(false);
    expect(linkPermitido("https://checkout.example.evil/pagar", null, ["checkout.example"])).toBe(false);
  });
  it("exige a forma e o vínculo de assinatura presentes e iguais", () => {
    expect(gatewayConfere(local, remoto, agora)).toBe(true);
    expect(gatewayConfere(local, { ...remoto, forma: null }, agora)).toBe(false);
    expect(gatewayConfere(local, { ...remoto, forma: "PIX" }, agora)).toBe(false);
    expect(gatewayConfere(local, { ...remoto, assinaturaGatewayId: null }, agora)).toBe(false);
    expect(gatewayConfere(local, { ...remoto, assinaturaGatewayId: "outra" }, agora)).toBe(false);
    expect(gatewayConfere({ ...local, assinaturaGatewayId: null }, remoto, agora)).toBe(false);
    expect(gatewayConfere(local, { ...remoto, abertaConfirmada: false }, agora)).toBe(false);
    expect(gatewayConfere(local, { ...remoto, abertaConfirmada: undefined }, agora)).toBe(false);
    expect(gatewayConfere(local, { ...remoto, vencimentoConfirmado: false }, agora)).toBe(false);
    expect(gatewayConfere(local, { ...remoto, vencimentoConfirmado: undefined }, agora)).toBe(false);
  });
});
