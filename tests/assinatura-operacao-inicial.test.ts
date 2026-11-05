import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ buscar: vi.fn(), atualizar: vi.fn(), atualizarMuitas: vi.fn(), cobranca: vi.fn(), emissao: vi.fn(), atualizarCobrancas: vi.fn(), audit: vi.fn(), gateway: vi.fn(), consultar: vi.fn(), cancelar: vi.fn(), criar: vi.fn(), tx: vi.fn(), lock: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: m.tx, assinatura: { update: m.atualizar, updateMany: m.atualizarMuitas } } }));
vi.mock("@/lib/auditoria", () => ({ auditar: m.audit }));
vi.mock("@/lib/pagamentos/gateway", () => ({ gatewayPorId: m.gateway }));
import { cancelamentoSemRecebimento, cancelarOperacaoInicial, marcarPagamentoInicialIncerto, reservarPagamentoInicial } from "@/lib/assinaturas/operacao-inicial";

const assinatura = () => ({ id: "a", status: "PENDENTE", operacaoInicial: null, ativadaEm: null, formaPagamento: "CARTAO", gatewayId: null, gatewayClienteId: "simcus_c", cobrancas: [] as { id: string; gatewayId: string; status: string; valorCentavos: number }[] });
let a: ReturnType<typeof assinatura>;
const prova = { id: "ch_1", status: "CANCELADA" as const, valorCentavos: 12000, moeda: "BRL", liquidadoCentavos: 0, pagaEm: null, link: null };
beforeEach(() => {
  vi.clearAllMocks(); a = assinatura();
  m.buscar.mockImplementation(async () => structuredClone(a));
  m.atualizar.mockImplementation(async ({ data }) => { Object.assign(a, data); return a; });
  m.tx.mockImplementation(async cb => cb({ $executeRaw: m.lock, assinatura: { findUnique: m.buscar, findUniqueOrThrow: m.buscar, update: m.atualizar }, cobranca: { findFirst: m.cobranca, updateMany: m.atualizarCobrancas }, emissaoPixMensal: { findFirst: m.emissao } }));
  m.cobranca.mockResolvedValue(null); m.emissao.mockResolvedValue(null);
  m.gateway.mockResolvedValue({ nome: "pagarme", buscarCobrancaAvulsa: m.consultar, cancelarAssinatura: m.cancelar, criarAssinatura: m.criar });
  m.consultar.mockResolvedValue(prova);
});

describe("cancelamento da operação inicial", () => {
  it("cancela sem provedor quando o cartão ainda não foi enviado", async () => {
    expect(await cancelarOperacaoInicial("a", "u")).toEqual({ cancelada: true, emConferencia: false });
    expect(a.status).toBe("CANCELADA"); expect(m.gateway).not.toHaveBeenCalled(); expect(m.audit).toHaveBeenCalledTimes(2);
  });
  it("é idempotente para uma operação já cancelada", async () => {
    a.status = "CANCELADA";
    expect((await cancelarOperacaoInicial("a", "u")).cancelada).toBe(true);
    expect(m.atualizar).not.toHaveBeenCalled();
  });
  it.each(["ATIVA", "ATRASADA"])("não cancela nem estorna assinatura %s", async status => {
    a.status = status;
    await expect(cancelarOperacaoInicial("a", "u")).rejects.toMatchObject({ codigo: "ja_pago" });
    expect(m.cancelar).not.toHaveBeenCalled();
  });
  it("não cancela se já existe pagamento mesmo com status pendente", async () => {
    a.cobrancas = [{ id: "c", gatewayId: "ch_1", status: "PAGA", valorCentavos: 12000 }];
    await expect(cancelarOperacaoInicial("a", "u")).rejects.toMatchObject({ codigo: "ja_pago" });
  });
  it.each(["CRIANDO", "CARTAO", "PIX", "INCERTA", "CANCELANDO"])("bloqueia cancelamento concorrente com %s", async estado => {
    a.operacaoInicial = estado as never;
    await expect(cancelarOperacaoInicial("a", "u")).rejects.toMatchObject({ codigo: "assinatura_operacao_revisao" });
    expect(m.gateway).not.toHaveBeenCalled();
  });
  it("Pix real em aberto fica em conferência, sem DELETE que poderia estornar", async () => {
    a.gatewayId = "pixrec_a" as never;
    a.cobrancas = [{ id: "c", gatewayId: "ch_1", status: "PENDENTE", valorCentavos: 12000 }];
    m.consultar.mockResolvedValue({ ...prova, status: "PENDENTE" });
    expect(await cancelarOperacaoInicial("a", "u")).toEqual({ cancelada: false, emConferencia: true });
    expect(a.operacaoInicial).toBe("CANCELAMENTO_REVISAO"); expect(a.status).toBe("PENDENTE"); expect(m.cancelar).not.toHaveBeenCalled(); expect(m.criar).not.toHaveBeenCalled();
  });
  it("reconfere Pix previamente encerrado com zero recebido e então libera nova adesão", async () => {
    a.gatewayId = "pixrec_a" as never; a.operacaoInicial = "CANCELAMENTO_REVISAO" as never;
    a.cobrancas = [{ id: "c", gatewayId: "ch_1", status: "PENDENTE", valorCentavos: 12000 }];
    expect((await cancelarOperacaoInicial("a", "u")).cancelada).toBe(true);
    expect(a.status).toBe("CANCELADA"); expect(a.operacaoInicial).toBeNull(); expect(m.cancelar).not.toHaveBeenCalled();
  });
  it("contrato externo ainda existente impede cancelamento local mesmo com cobrança cancelada", async () => {
    a.gatewayId = "sub_a" as never;
    expect((await cancelarOperacaoInicial("a", "u")).emConferencia).toBe(true);
    expect(a.status).toBe("PENDENTE");
  });
  it("falha de consulta mantém o bloqueio durável", async () => {
    a.gatewayId = "pixrec_a" as never; a.cobrancas = [{ id: "c", gatewayId: "ch_1", status: "PENDENTE", valorCentavos: 12000 }];
    m.consultar.mockRejectedValue(new Error("timeout"));
    await expect(cancelarOperacaoInicial("a", "u")).rejects.toMatchObject({ codigo: "assinatura_operacao_revisao" });
    expect(m.atualizarMuitas).toHaveBeenCalledWith(expect.objectContaining({ data: { operacaoInicial: "CANCELAMENTO_REVISAO" } }));
  });
  it("emissão Pix incerta impede cancelar e criar cartão", async () => {
    m.emissao.mockResolvedValue({ id: "e" });
    await expect(cancelarOperacaoInicial("a", "u")).rejects.toMatchObject({ codigo: "assinatura_operacao_revisao" });
    await expect(reservarPagamentoInicial("a", "CARTAO")).rejects.toMatchObject({ codigo: "assinatura_operacao_revisao" });
  });
  it("claim impede segunda tentativa de cartão antes de resolver a primeira", async () => {
    await reservarPagamentoInicial("a", "CARTAO");
    expect(a.operacaoInicial).toBe("CARTAO");
    await expect(reservarPagamentoInicial("a", "CARTAO")).rejects.toMatchObject({ codigo: "assinatura_operacao_revisao" });
  });
  it("erro após efeito externo marca criação incerta e não apaga a assinatura", async () => {
    await marcarPagamentoInicialIncerto("a");
    expect(m.atualizarMuitas).toHaveBeenCalledWith({ where: { id: "a", operacaoInicial: { in: ["CRIANDO", "CARTAO", "PIX"] } }, data: { operacaoInicial: "INCERTA" } });
  });
});

describe("prova de cancelamento sem recebimento", () => {
  it("exige status, vínculo, moeda e valor explícitos", () => {
    expect(cancelamentoSemRecebimento(prova, "ch_1", 12000)).toBe(true);
    for (const mudanca of [{ liquidadoCentavos: undefined }, { liquidadoCentavos: 1 }, { moeda: "USD" }, { valorCentavos: 11000 }, { id: "outro" }, { pagaEm: "2026-11-04T12:00:00Z" }, { status: "PAGA" as const }]) {
      expect(cancelamentoSemRecebimento({ ...prova, ...mudanca }, "ch_1", 12000)).toBe(false);
    }
  });
});
