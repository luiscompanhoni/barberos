import { describe, expect, it } from "vitest";
import { avaliarCobrancaAutomatica } from "@/lib/assinaturas/cobranca-automatica-regras";

const cobranca = { status: "PENDENTE", vencimento: new Date("2031-01-01"), forma: "PIX", expiraEm: new Date("2031-01-05"), link: "/c/pagar/token", tokenPublico: "token", assinaturaStatus: "PENDENTE", pausadaEm: null, encerraEm: null, aceitaMensagens: true, excluido: false, historicaVinculada: false };
describe("avisos de assinatura em conferência", () => {
  it.each(["CRIANDO", "CARTAO", "PIX", "INCERTA", "CANCELANDO", "CANCELAMENTO_REVISAO"])("bloqueia aviso automático quando a operação está %s", operacaoInicial => {
    expect(avaliarCobrancaAutomatica({ ...cobranca, operacaoInicial }, "2031-01-01", new Date("2031-01-01T12:00:00Z"))).toEqual({ estado: "REVISAO", motivo: "operacao_inicial_em_conferencia" });
  });
  it("mantém a elegibilidade normal depois da operação concluída", () => {
    expect(avaliarCobrancaAutomatica({ ...cobranca, operacaoInicial: null }, "2031-01-01", new Date("2031-01-01T12:00:00Z"))).toEqual({ estado: "PREPARADA", motivo: null });
  });
});
