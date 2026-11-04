import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ buscar: vi.fn(), atualizar: vi.fn(), transacao: vi.fn(), consultar: vi.fn(), criar: vi.fn(), cancelar: vi.fn(), pago: vi.fn(), avisar: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { linkPagamento: { findUnique: m.buscar, findUniqueOrThrow: m.buscar }, $transaction: m.transacao } }));
vi.mock("@/lib/auditoria", () => ({ auditar: vi.fn() }));
vi.mock("@/lib/agenda/carregar", () => ({ configuracao: async () => ({ nomeBarbearia: "Black sintética", fuso: "America/Sao_Paulo" }) }));
vi.mock("@/lib/assinaturas/cobrancas", () => ({ linkAbsoluto: (p: string) => `https://example.invalid${p}` }));
vi.mock("@/lib/whatsapp/conversas", () => ({ notificarEmSegundoPlano: vi.fn() }));
vi.mock("@/lib/comandas/servico", () => ({ avisarComanda: m.avisar }));
vi.mock("@/lib/pagamentos/gateway", () => ({ gateway: async () => ({ nome: "pagarme", cartao: "token", exigeEmail: false, criarCliente: async () => "cus_teste", criarCobrancaAvulsa: m.criar }), gatewayPorId: async () => ({ nome: "pagarme", cartao: "token", buscarCobrancaAvulsa: m.consultar, cancelarCobrancaAvulsa: m.cancelar }) }));
import { cancelarLink, pagarLink } from "@/lib/links/checkout";
import { sincronizarLink } from "@/lib/links/sincronizacao";

const exato = { id: "or_teste", status: "PAGA", pagaEm: "2030-01-02T15:00:00Z", valorCentavos: 6000, moeda: "BRL", liquidadoCentavos: 6000 };
const cadastro = () => ({ id: "link_teste", token: "token_sintetico", nome: "Cliente sintético", telefone: "5511999990000", clienteId: null, cliente: null, comandaId: "comanda_teste", comanda: { status: "ABERTA", numero: 1 },
  descricao: "Corte sintético", status: "PENDENTE", forma: "PIX", gatewayId: "or_teste" as string | null, tentativaChave: "lk-link_teste-chave" as string | null,
  valorCentavos: 6000, expiraEm: new Date(Date.now() + 86_400_000), parcelasMax: 1, cpf: "52998224725", email: "cliente@example.invalid", pixCopiaECola: null, pixExpiraEm: null });
let link: ReturnType<typeof cadastro>;
beforeEach(() => {
  vi.resetAllMocks(); link = cadastro();
  const tx = { $queryRaw: vi.fn(), linkPagamento: { findUnique: m.buscar, findUniqueOrThrow: m.buscar, update: m.atualizar },
    comanda: { findUniqueOrThrow: async () => ({ status: "ABERTA", descontoCentavos: 0, itens: [{ quantidade: 1, precoUnitCentavos: 6000 }], pagamentos: [] }) },
    pagamentoComanda: { findUnique: async () => null, create: m.pago } };
  m.buscar.mockImplementation(async () => ({ ...link }));
  m.atualizar.mockImplementation(async ({ data }) => { Object.assign(link, data); return { ...link }; });
  m.transacao.mockImplementation(async (fn) => fn(tx));
  m.consultar.mockResolvedValue(exato); m.criar.mockResolvedValue(exato);
});

describe("liquidação monetária de links", () => {
  it.each([
    { valorCentavos: 5900, liquidadoCentavos: 5900 }, { moeda: "USD" }, { liquidadoCentavos: 1 }, { liquidadoCentavos: 6001 },
    { moeda: undefined }, { valorCentavos: undefined }, { liquidadoCentavos: undefined }, { liquidadoCentavos: 6000.1 },
  ])("status PAGA com prova divergente não quita a comanda (%j)", async (extra) => {
    m.consultar.mockResolvedValue({ ...exato, ...extra });
    await sincronizarLink(link.id);
    expect(link.status).toBe("PENDENTE");
    expect(m.pago).not.toHaveBeenCalled();
    expect(link.gatewayId).toBe("or_teste");
    expect(link.tentativaChave).toMatch(/^conferir:/);
  });
  it("resposta imediata PAGA parcial não credita o valor integral", async () => {
    link.gatewayId = null; link.tentativaChave = null;
    m.criar.mockResolvedValue({ ...exato, liquidadoCentavos: 100 });
    await expect(pagarLink(link.token, { forma: "PIX" })).rejects.toMatchObject({ codigo: "liquidacao_divergente" });
    expect(link.status).toBe("PENDENTE");
    expect(m.pago).not.toHaveBeenCalled();
  });
  it("liquidação exata quita uma única vez", async () => {
    await sincronizarLink(link.id); await sincronizarLink(link.id);
    expect(link.status).toBe("PAGO");
    expect(m.pago).toHaveBeenCalledOnce();
    expect(m.pago.mock.calls[0][0].data.valorCentavos).toBe(6000);
  });
  it("PAGA imediata com prova exata quita a comanda", async () => {
    link.gatewayId = null; link.tentativaChave = null;
    expect((await pagarLink(link.token, { forma: "PIX" })).status).toBe("PAGO");
    expect(m.pago).toHaveBeenCalledOnce();
  });
  it("pagamento tardio completo vence a tentativa de cancelamento e não duplica receita", async () => {
    link.expiraEm = new Date(Date.now() - 60_000); link.tentativaChave = "cancelar:link_teste:1";
    await expect(cancelarLink(null, link.id)).rejects.toMatchObject({ codigo: "ja_pago" });
    await sincronizarLink(link.id);
    expect(link.status).toBe("PAGO"); expect(m.pago).toHaveBeenCalledOnce(); expect(m.cancelar).not.toHaveBeenCalled();
  });
  it("pagamento parcial já recebido não vira cancelamento automático pela recepção", async () => {
    m.consultar.mockResolvedValue({ ...exato, liquidadoCentavos: 100 });
    await expect(cancelarLink(null, link.id)).rejects.toMatchObject({ codigo: "liquidacao_divergente" });
    expect(link.status).toBe("PENDENTE"); expect(m.cancelar).not.toHaveBeenCalled(); expect(m.pago).not.toHaveBeenCalled();
  });
  it("retorno terminal sem prova de saldo zerado mantém a reserva", async () => {
    m.consultar.mockResolvedValue({ ...exato, status: "CANCELADA", liquidadoCentavos: 1 });
    await sincronizarLink(link.id);
    expect(link.status).toBe("PENDENTE"); expect(link.gatewayId).toBe("or_teste"); expect(link.tentativaChave).toMatch(/^conferir:/);
  });
  it("retorno antigo não remove a reserva de uma tentativa mais recente", async () => {
    m.consultar.mockImplementation(async () => {
      link.gatewayId = "or_novo"; link.tentativaChave = "lk-nova-tentativa";
      return { ...exato, status: "CANCELADA", liquidadoCentavos: 0 };
    });
    await sincronizarLink(link.id);
    expect(link.gatewayId).toBe("or_novo"); expect(link.tentativaChave).toBe("lk-nova-tentativa"); expect(m.atualizar).not.toHaveBeenCalled();
  });
});
