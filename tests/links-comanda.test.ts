import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ transacao: vi.fn(), trava: vi.fn(), comanda: vi.fn(), cliente: vi.fn(), criar: vi.fn(), auditar: vi.fn(), notificar: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: m.transacao } }));
vi.mock("@/lib/auditoria", () => ({ auditar: m.auditar }));
vi.mock("@/lib/agenda/carregar", () => ({ configuracao: vi.fn() }));
vi.mock("@/lib/assinaturas/cobrancas", () => ({ linkAbsoluto: (caminho: string) => `https://example.test${caminho}`, novoTokenPublico: () => "token-sintetico" }));
vi.mock("@/lib/pagamentos/gateway", () => ({ gateway: vi.fn(), gatewayPorId: vi.fn() }));
vi.mock("@/lib/whatsapp/conversas", () => ({ notificarCliente: m.notificar, notificarEmSegundoPlano: vi.fn() }));

import { criarLink } from "@/lib/links/servico";
import type { Sessao } from "@/lib/auth/sessao";

const sessao = { usuarioId: "recepcao-teste", papel: "RECEPCAO" } as Sessao;
const tx = { $queryRaw: m.trava, comanda: { findUnique: m.comanda }, cliente: { findUnique: m.cliente }, linkPagamento: { create: m.criar } };
const pedido = { comandaId: "comanda-teste", descricao: "Comanda sintética", valorCentavos: 6000, validadeDias: 1, parcelasMax: 1, enviar: false };
const base = () => ({ id: pedido.comandaId, status: "ABERTA", numero: 10, nomeAvulso: "Cliente Teste", clienteId: null, descontoCentavos: 0,
  itens: [{ quantidade: 1, precoUnitCentavos: 6000 }], pagamentos: [], linksPagamento: [] });

beforeEach(() => {
  vi.resetAllMocks();
  m.transacao.mockImplementation(async (executar) => executar(tx));
  m.comanda.mockResolvedValue(base());
  m.criar.mockImplementation(async ({ data }) => ({ ...data, id: "link-teste", status: "PENDENTE", forma: null, parcelas: null, pagoEm: null, criadoEm: new Date(), comanda: { numero: 10, status: "ABERTA" } }));
});

describe("link da comanda e cobrança na maquininha", () => {
  const criar = (extra = {}) => criarLink(sessao, { ...pedido, telefone: "11999990000", ...extra });

  it("trava e relê a comanda antes de reservar o saldo; não envia mensagem por padrão", async () => {
    const ordem: string[] = [];
    m.trava.mockImplementation(async () => { ordem.push("trava"); });
    m.comanda.mockImplementation(async () => { ordem.push("leitura"); return base(); });
    m.criar.mockImplementation(async ({ data }) => { ordem.push("reserva"); return { ...data, id: "link-teste", status: "PENDENTE" }; });
    const resultado = await criar();
    expect(ordem).toEqual(["trava", "leitura", "reserva"]);
    expect(String(m.trava.mock.calls[0][0])).toContain("FOR UPDATE");
    expect(m.auditar).toHaveBeenCalledWith(tx, sessao.usuarioId, "criar_link_pagamento", "link_pagamento", "link-teste", expect.objectContaining({ valorCentavos: 6000 }));
    expect(resultado.envio).toBeNull();
    expect(m.notificar).not.toHaveBeenCalled();
  });

  it("não cria link enquanto houver POS aguardando, mesmo sem id externo", async () => {
    m.comanda.mockResolvedValue({ ...base(), pagamentos: [{ forma: "DEBITO", valorCentavos: 1000, status: "AGUARDANDO", gatewayPedidoId: null }] });
    await expect(criar({ valorCentavos: 1000 })).rejects.toMatchObject({ codigo: "pagamento_pendente", status: 409 });
    expect(m.criar).not.toHaveBeenCalled();
    expect(m.notificar).not.toHaveBeenCalled();
  });

  it("relê comanda fechada depois da trava e não reserva nem envia", async () => {
    m.comanda.mockResolvedValue({ ...base(), status: "FECHADA" });
    await expect(criar()).rejects.toThrow("já foi fechada");
    expect(m.criar).not.toHaveBeenCalled();
  });

  it("desconta pagamento recebido e link existente do valor disponível", async () => {
    m.comanda.mockResolvedValue({ ...base(),
      pagamentos: [{ forma: "DINHEIRO", valorCentavos: 1000, status: "PAGO" }],
      linksPagamento: [{ status: "PENDENTE", valorCentavos: 2000, expiraEm: new Date(Date.now() + 60_000) }],
    });
    await expect(criar({ valorCentavos: 3001 })).rejects.toThrow();
    expect(m.criar).not.toHaveBeenCalled();
    await criar({ valorCentavos: 3000 });
    expect(m.criar).toHaveBeenCalledOnce();
  });

  it("recusa a segunda reserva integral após a primeira transação gravar o link", async () => {
    let reservado = false;
    m.comanda.mockImplementation(async () => ({ ...base(), linksPagamento: reservado ? [{ status: "PENDENTE", valorCentavos: 6000, expiraEm: new Date(Date.now() + 60_000) }] : [] }));
    m.criar.mockImplementation(async ({ data }) => { reservado = true; return { ...data, id: "link-teste", status: "PENDENTE" }; });
    await criar();
    await expect(criar()).rejects.toThrow();
    expect(m.criar).toHaveBeenCalledOnce();
  });
});
