import { beforeEach, describe, expect, it, vi } from "vitest";
import { dividirEmBolhas } from "@/lib/bot/bolhas";
import { ABERTURA_SOBRE_PLANO, CONHECIMENTO_ATENDIMENTO } from "@/lib/bot/conhecimento-atendimento";

const m = vi.hoisted(() => ({
  cliente: vi.fn(),
  situacao: vi.fn(),
  link: vi.fn(),
  alteracao: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { cliente: { findUnique: m.cliente } } }));
vi.mock("@/lib/assinaturas/servico", () => ({ situacaoDoCliente: m.situacao }));
vi.mock("@/lib/assinaturas/link-atendimento", () => ({ linkDaMensalidadeParaAtendimento: m.link }));
vi.mock("@/lib/assinaturas/alteracao-plano", () => ({ alteracaoAtual: m.alteracao }));
vi.mock("@/lib/bot/ferramentas-cancelamento", () => ({ executarCancelamento: vi.fn() }));
import { executarAssinatura } from "@/lib/bot/ferramentas-assinatura";

const ctx = { conversaId: "conversa", telefone: "5547999990000", nomePerfil: "Cliente" };
const assinatura = {
  id: "contrato",
  gatewayId: "cashbarber:celcoin:321",
  status: "ATRASADA",
  formaPagamento: "CARTAO",
  precoCentavos: 11800,
  plano: { nome: "Plano de Corte" },
};
const cobrancaEmAberto = { id: "fatura", forma: "PIX", valorCentavos: 11800, vencimento: new Date("2026-11-13T00:00:00.000Z") };

beforeEach(() => {
  vi.resetAllMocks();
  m.cliente.mockResolvedValue({ id: "cliente", excluidoEm: null });
  m.situacao.mockResolvedValue({ assinatura, cobrancaEmAberto, valida: false });
});

describe("Leonel e mensalidades do CashBarber", () => {
  it("orienta dois balões e espera a resposta na abertura sobre plano", () => {
    const modelo = ABERTURA_SOBRE_PLANO.replace("{nome}", "Cliente");
    expect(dividirEmBolhas(modelo)).toEqual([
      "Oi, Cliente, tudo bem? Aqui é o Leonel da Black.",
      "Consegue falar rapidinho sobre o teu plano?",
    ]);
    expect(CONHECIMENTO_ATENDIMENTO).toContain(ABERTURA_SOBRE_PLANO);
    expect(CONHECIMENTO_ATENDIMENTO).toContain("Aguarde a resposta após o segundo");
  });

  it("orienta conferir o legado quando o plano não aparece no cadastro", async () => {
    m.situacao.mockResolvedValue(null);
    const r = await executarAssinatura("minha_assinatura", {}, ctx);
    expect(r.texto).toContain("conferir o vínculo no CashBarber");
    expect(m.link).not.toHaveBeenCalled();
  });

  it("não transforma o atraso local em dívida confirmada", async () => {
    const resposta = JSON.parse((await executarAssinatura("minha_assinatura", {}, ctx)).texto);
    expect(resposta).toMatchObject({ plano: "Plano de Corte", cobranca_externa: true, em_conferencia: true });
    expect(resposta).not.toHaveProperty("status");
    expect(resposta).not.toHaveProperty("pagamento_em_aberto");
    expect(m.link).not.toHaveBeenCalled();
  });

  it("encaminha pedidos de Pix no legado sem oferecer um segundo pagamento", async () => {
    const r = await executarAssinatura("link_pagamento_assinatura", { forma: "PIX" }, ctx);
    const resposta = JSON.parse(r.texto);
    expect(r.erro).toBe(true);
    expect(resposta).toMatchObject({ em_conferencia: true, orientar: expect.stringContaining("Celcoin") });
    expect(resposta).not.toHaveProperty("link");
    expect(m.link).not.toHaveBeenCalled();
  });

  it("devolve o link confirmado da mesma fatura quando a assinatura é local", async () => {
    m.situacao.mockResolvedValue({ assinatura: { ...assinatura, gatewayId: "pixrec_321" }, cobrancaEmAberto });
    m.link.mockResolvedValue({ link: "https://app.example.test/c/pagar/fatura" });
    const r = await executarAssinatura("link_pagamento_assinatura", { forma: "PIX" }, ctx);
    expect(JSON.parse(r.texto)).toMatchObject({ link: "https://app.example.test/c/pagar/fatura", cobranca_existente: true });
    expect(m.link).toHaveBeenCalledWith("cliente", "fatura");
  });
});
