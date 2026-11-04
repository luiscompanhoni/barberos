import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ transacao: vi.fn(), buscar: vi.fn(), atualizar: vi.fn(), trava: vi.fn(), comanda: vi.fn(), auditar: vi.fn(), criarCliente: vi.fn(), criarCobranca: vi.fn(), consultar: vi.fn(), cancelar: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: m.transacao, linkPagamento: { findUnique: m.buscar, findUniqueOrThrow: m.buscar } } }));
vi.mock("@/lib/auditoria", () => ({ auditar: m.auditar }));
vi.mock("@/lib/agenda/carregar", () => ({ configuracao: async () => ({ nomeBarbearia: "Black teste", fuso: "America/Sao_Paulo" }) }));
vi.mock("@/lib/assinaturas/cobrancas", () => ({ linkAbsoluto: (path: string) => `https://example.test${path}` }));
vi.mock("@/lib/whatsapp/conversas", () => ({ notificarEmSegundoPlano: vi.fn() }));
vi.mock("@/lib/pagamentos/gateway", () => ({ gateway: async () => ({ cartao: "token", exigeEmail: true, criarCliente: m.criarCliente, criarCobrancaAvulsa: m.criarCobranca }), gatewayPorId: async () => ({ cartao: "token", buscarCobrancaAvulsa: m.consultar, cancelarCobrancaAvulsa: m.cancelar }) }));

import { pagarLink, cancelarLink } from "@/lib/links/checkout";
import { sincronizarLink } from "@/lib/links/sincronizacao";
import { estadoCheckoutLink } from "@/lib/links/estado";
import type { LinkPagamento } from "@prisma/client";

let link: LinkPagamento;
const tx = { $queryRaw: m.trava, linkPagamento: { findUnique: m.buscar, findUniqueOrThrow: m.buscar, update: m.atualizar }, comanda: { findUniqueOrThrow: m.comanda } };
const pix = { forma: "PIX" as const, cpf: "52998224725", email: "sintetico@example.test" };

beforeEach(() => {
  vi.resetAllMocks();
  link = { id: "link-1", token: "token-1", nome: "Cliente teste", telefone: "5511999990000", descricao: "Corte teste", valorCentavos: 6000, clienteId: null, cpf: null, email: null, comandaId: null,
    status: "PENDENTE", forma: null, parcelasMax: 1, parcelas: null, tentativaChave: null, gatewayId: null, pixCopiaECola: null, pixQrUrl: null, pixExpiraEm: null, pagoEm: null,
    expiraEm: new Date(Date.now() + 86400_000), criadoPorId: null, criadoEm: new Date(), atualizadoEm: new Date() };
  let fila = Promise.resolve();
  m.transacao.mockImplementation(async (executar) => {
    const anterior = fila;
    let liberar!: () => void;
    fila = new Promise<void>((resolve) => { liberar = resolve; });
    await anterior;
    try { return await executar(tx); } finally { liberar(); }
  });
  m.buscar.mockImplementation(async () => ({ ...link, cliente: null, comanda: null }));
  m.atualizar.mockImplementation(async ({ data }) => { Object.assign(link, data); return { ...link, cliente: null, comanda: null }; });
  m.criarCliente.mockImplementation(async () => { expect(link.tentativaChave).toMatch(/^lk-link-1-/); return "cus_teste"; });
  m.criarCobranca.mockResolvedValue({ id: "or_teste", status: "PENDENTE", valorCentavos: 6000, moeda: "BRL", liquidadoCentavos: 0, pixCopiaECola: "pix-sintetico", pagaEm: null });
  m.consultar.mockResolvedValue({ id: "or_teste", status: "PENDENTE", valorCentavos: 6000, moeda: "BRL", liquidadoCentavos: 0, pagaEm: null });
});

describe("checkout de links sem cobrança duplicada", () => {
  it("reserva antes do HTTP e só envia uma cobrança para requisições paralelas", async () => {
    const r = await Promise.all([pagarLink(link.token, pix), pagarLink(link.token, pix)]);
    expect(m.criarCobranca).toHaveBeenCalledOnce();
    expect(m.criarCliente).toHaveBeenCalledOnce();
    expect(m.criarCobranca.mock.calls[0][0].referencia).toBe(link.tentativaChave);
    expect(r.some((x) => x.pix?.copiaECola === "pix-sintetico")).toBe(true);
    expect(m.auditar).toHaveBeenCalledWith(tx, null, "reservar_tentativa_link", "link_pagamento", link.id, expect.objectContaining({ forma: "PIX" }));
  });

  it("timeout conserva intenção sem gateway e bloqueia nova forma, expiração e cancelamento", async () => {
    m.criarCobranca.mockRejectedValue(Error("timeout depois do aceite"));
    await expect(pagarLink(link.token, pix)).rejects.toMatchObject({ codigo: "pagamento_incerto" });
    const tentativa = link.tentativaChave;
    expect(tentativa).toBeTruthy();
    expect(link.gatewayId).toBeNull();
    link.expiraEm = new Date(Date.now() - 1000);
    expect((await pagarLink(link.token, { ...pix, forma: "CARTAO", cartaoToken: "token_sintetico" })).processando).toBe(true);
    await expect(cancelarLink(null, link.id, "expirado")).rejects.toMatchObject({ codigo: "pagamento_incerto" });
    expect(link.status).toBe("PENDENTE");
    expect(link.tentativaChave).toBe(tentativa);
    expect(m.criarCobranca).toHaveBeenCalledOnce();
    expect(m.cancelar).not.toHaveBeenCalled();
  });

  it("falha de cancelamento não cancela localmente e mantém a reserva após vencer", async () => {
    link.gatewayId = "or_teste";
    link.tentativaChave = "lk-link-1-antes";
    link.forma = "PIX";
    m.cancelar.mockRejectedValue(Error("indisponível"));
    await expect(cancelarLink(null, link.id)).rejects.toMatchObject({ codigo: "cancelamento_incerto" });
    expect(link.status).toBe("PENDENTE");
    expect(link.gatewayId).toBe("or_teste");
    expect(link.tentativaChave).toMatch(/^cancelar:/);
    link.expiraEm = new Date(Date.now() - 1000);
    expect(estadoCheckoutLink(link)).toMatchObject({ status: "PENDENTE", processando: true, pix: null });
    await pagarLink(link.token, pix);
    expect(m.criarCobranca).not.toHaveBeenCalled();
  });

  it("resposta do cancelamento sem estado terminal autoritativo não libera saldo", async () => {
    link.gatewayId = "or_teste";
    m.cancelar.mockResolvedValue(undefined);
    await expect(cancelarLink(null, link.id)).rejects.toMatchObject({ codigo: "cancelamento_pendente" });
    expect(link.status).toBe("PENDENTE");
    expect(link.gatewayId).toBe("or_teste");
  });

  it("consulta terminal após cancelamento encerra e libera a reserva atomicamente", async () => {
    link.gatewayId = "or_teste";
    m.cancelar.mockImplementation(async () => { m.consultar.mockResolvedValue({ id: "or_teste", status: "CANCELADA", valorCentavos: 6000, moeda: "BRL", liquidadoCentavos: 0, pagaEm: null }); });
    expect((await cancelarLink(null, link.id)).status).toBe("CANCELADO");
    expect(link.gatewayId).toBeNull();
    expect(link.tentativaChave).toBeNull();
  });

  it("não aplica retorno com identidade divergente", async () => {
    link.gatewayId = "or_teste";
    link.tentativaChave = "lk-link-1-antes";
    m.consultar.mockResolvedValue({ id: "or_outro", status: "CANCELADA", valorCentavos: 6000, moeda: "BRL", liquidadoCentavos: 0, pagaEm: null });
    await sincronizarLink(link.id);
    expect(link.gatewayId).toBe("or_teste");
    expect(m.atualizar).not.toHaveBeenCalled();
  });

  it("recusa autoritativa pode liberar uma nova tentativa; erro de transporte não é recusa", async () => {
    m.criarCobranca.mockResolvedValue({ id: "or_recusado", status: "ATRASADA", valorCentavos: 6000, moeda: "BRL", liquidadoCentavos: 0, pagaEm: null });
    await expect(pagarLink(link.token, { ...pix, forma: "CARTAO", cartaoToken: "token_sintetico" })).rejects.toMatchObject({ codigo: "cartao_recusado" });
    expect(link.tentativaChave).toBeNull();
    m.criarCobranca.mockResolvedValue({ id: "or_teste", status: "PENDENTE", valorCentavos: 6000, moeda: "BRL", liquidadoCentavos: 0, pagaEm: null });
    await pagarLink(link.token, pix);
    expect(m.criarCobranca).toHaveBeenCalledTimes(2);
  });
});
