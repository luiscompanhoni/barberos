import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ referencia: vi.fn(), atual: vi.fn(), upsert: vi.fn(), cobrancas: vi.fn(), atualizar: vi.fn(), marcar: vi.fn(), salva: vi.fn(), tx: vi.fn(), avisar: vi.fn(), publicar: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { assinatura: { findUnique: m.referencia }, cobranca: { findUnique: async () => null }, $transaction: m.tx } }));
vi.mock("@/lib/eventos", () => ({ publicar: m.publicar }));
vi.mock("@/lib/whatsapp/conversas", () => ({ notificarCliente: vi.fn(), notificarEmSegundoPlano: m.avisar }));
vi.mock("@/lib/whatsapp/piloto", () => ({ reservarEnvioPiloto: vi.fn() }));
vi.mock("@/lib/conciliacao/historico/sincronizacao", () => ({ conferirVinculoSincronizado: vi.fn() }));
vi.mock("@/lib/assinaturas/cobranca-automatica", () => ({}));
import { sincronizarCobranca } from "@/lib/assinaturas/cobrancas";

const assinatura = { id: "a", clienteId: "c", status: "ATIVA", ativadaEm: new Date("2030-01-01"), pausadaAte: null,
  proximoVencimento: new Date("2030-02-01"), cliente: { nome: "Teste", telefone: "telefone-ficticio" }, plano: { nome: "Plano" } };
const cobranca = { id: "simchg_teste", assinaturaGatewayId: "simsub_teste", valorCentavos: 10000, vencimento: "2030-02-01", status: "PAGA" as const, pagaEm: "2030-02-01T12:00:00Z", link: null };
beforeEach(() => {
  vi.clearAllMocks(); m.referencia.mockResolvedValue({ id: "a" }); m.atual.mockResolvedValue(assinatura);
  m.upsert.mockResolvedValue({ id: "cobranca", link: null }); m.atualizar.mockResolvedValue({ count: 1 });
  m.cobrancas.mockResolvedValue([{ status: "PAGA", vencimento: new Date("2030-02-01") }]);
  m.marcar.mockResolvedValue({ count: 0 }); m.salva.mockResolvedValue({ id: "cobranca", link: null });
  m.tx.mockImplementation(cb => cb({ $executeRaw: vi.fn(), assinatura: { findUniqueOrThrow: m.atual, updateMany: m.atualizar }, cobranca: { upsert: m.upsert, findMany: m.cobrancas, updateMany: m.marcar, findUniqueOrThrow: m.salva } }));
});

describe("vencimento local condicional", () => {
  const vencida = { ...cobranca, status: "ATRASADA" as const, pagaEm: null };
  it("descarta leitura vencida quando o pagamento já chegou", async () => {
    expect(await sincronizarCobranca(vencida, { apenasPendente: true })).toBeNull();
    expect(m.marcar).toHaveBeenCalledWith({ where: { gatewayId: cobranca.id, assinaturaId: "a", status: "PENDENTE" }, data: { status: "ATRASADA" } });
    expect(m.upsert).not.toHaveBeenCalled(); expect(m.atualizar).not.toHaveBeenCalled();
    expect(m.avisar).not.toHaveBeenCalled(); expect(m.publicar).not.toHaveBeenCalled();
  });
  it("não marca cobranças de uma assinatura encerrada depois da leitura", async () => {
    m.atual.mockResolvedValue({ ...assinatura, status: "CANCELADA" });
    expect(await sincronizarCobranca(vencida, { apenasPendente: true })).toBeNull();
    expect(m.marcar).not.toHaveBeenCalled(); expect(m.upsert).not.toHaveBeenCalled();
  });
  it("marca a pendência restante sem sobrescrever valor, data de pagamento ou detalhes", async () => {
    m.marcar.mockResolvedValue({ count: 1 });
    m.cobrancas.mockResolvedValue([{ status: "PAGA", vencimento: new Date("2030-01-01") }, { status: "ATRASADA", vencimento: new Date("2030-02-01") }]);
    expect(await sincronizarCobranca(vencida, { apenasPendente: true })).toEqual({ de: "ATIVA", para: "ATRASADA" });
    expect(m.upsert).not.toHaveBeenCalled(); expect(m.salva).toHaveBeenCalledTimes(1);
  });
});

describe("conciliação preserva encerramento inicial", () => {
  it("relê cancelamento depois da consulta inicial e registra evidência recebida sem reativar", async () => {
    m.atual.mockResolvedValue({ ...assinatura, status: "CANCELADA" });
    expect(await sincronizarCobranca(cobranca)).toEqual({ de: "CANCELADA", para: "CANCELADA" });
    expect(m.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ status: "PAGA", valorCentavos: 10000 }) }));
    expect(m.atualizar).not.toHaveBeenCalled(); expect(m.avisar).not.toHaveBeenCalled(); expect(m.publicar).not.toHaveBeenCalled();
  });
  it("encerramento concorrente fora da trava também impede reabertura e avisos", async () => {
    m.atualizar.mockResolvedValue({ count: 0 });
    expect(await sincronizarCobranca(cobranca)).toEqual({ de: "CANCELADA", para: "CANCELADA" });
    expect(m.atualizar).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "a", status: { not: "CANCELADA" } } }));
    expect(m.avisar).not.toHaveBeenCalled(); expect(m.publicar).not.toHaveBeenCalled();
  });
  it("renovação de assinatura ainda ativa continua conciliando o ciclo", async () => {
    expect(await sincronizarCobranca(cobranca)).toEqual({ de: "ATIVA", para: "ATIVA" });
    expect(m.atualizar).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "ATIVA", cicloInicio: new Date("2030-02-01"), proximoVencimento: new Date("2030-03-01") } }));
    expect(m.publicar).toHaveBeenCalledTimes(1); expect(m.avisar).not.toHaveBeenCalled();
  });
});
