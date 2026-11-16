import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ buscar: vi.fn(), atualizar: vi.fn(), atualizarMuitas: vi.fn(), cobranca: vi.fn(), emissao: vi.fn(), atualizarCobrancas: vi.fn(), audit: vi.fn(), gateway: vi.fn(), consultar: vi.fn(), cancelar: vi.fn(), cancelarCobranca: vi.fn(), criar: vi.fn(), tx: vi.fn(), lock: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: m.tx, assinatura: { update: m.atualizar, updateMany: m.atualizarMuitas } } }));
vi.mock("@/lib/auditoria", () => ({ auditar: m.audit }));
vi.mock("@/lib/pagamentos/gateway", () => ({ gatewayPorId: m.gateway }));
import { cancelamentoSemRecebimento, cancelarOperacaoInicial, manterOperacaoInicial, marcarPagamentoInicialIncerto, reservarPagamentoInicial } from "@/lib/assinaturas/operacao-inicial";

const assinatura = () => ({ id: "a", status: "PENDENTE", operacaoInicial: null, ativadaEm: null, formaPagamento: "CARTAO", gatewayId: null, gatewayClienteId: "simcus_c", cobrancas: [] as { id: string; gatewayId: string; status: string; valorCentavos: number }[] });
let a: ReturnType<typeof assinatura>;
const prova = { id: "ch_1", status: "CANCELADA" as const, valorCentavos: 12000, moeda: "BRL", liquidadoCentavos: 0, pagaEm: null, link: null };
beforeEach(() => {
  vi.clearAllMocks(); a = assinatura();
  m.buscar.mockImplementation(async () => structuredClone(a));
  m.atualizar.mockImplementation(async ({ data }) => { Object.assign(a, data); return a; });
  m.atualizarMuitas.mockImplementation(async ({ where, data }) => {
    if (where.operacaoInicial !== a.operacaoInicial || (where.status && where.status !== a.status)) return { count: 0 };
    Object.assign(a, data);
    return { count: 1 };
  });
  m.tx.mockImplementation(async cb => cb({ $executeRaw: m.lock, assinatura: { findUnique: m.buscar, findUniqueOrThrow: m.buscar, update: m.atualizar }, cobranca: { findFirst: m.cobranca, updateMany: m.atualizarCobrancas }, emissaoPixMensal: { findFirst: m.emissao } }));
  m.cobranca.mockResolvedValue(null); m.emissao.mockResolvedValue(null);
  m.gateway.mockResolvedValue({ nome: "pagarme", buscarCobrancaAvulsa: m.consultar, cancelarAssinatura: m.cancelar, cancelarCobranca: m.cancelarCobranca, criarAssinatura: m.criar });
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
  it.each(["CRIANDO", "CARTAO", "PIX", "INCERTA", "CANCELANDO", "MANTENDO"])("bloqueia cancelamento concorrente com %s", async estado => {
    a.operacaoInicial = estado as never;
    await expect(cancelarOperacaoInicial("a", "u")).rejects.toMatchObject({ codigo: "assinatura_operacao_revisao" });
    expect(m.gateway).not.toHaveBeenCalled();
  });
  it("não chama a rota de estorno se o Pix pode ser pago enquanto o cancelamento é conferido", async () => {
    a.gatewayId = "pixrec_a" as never;
    a.cobrancas = [{ id: "c", gatewayId: "ch_1", status: "PENDENTE", valorCentavos: 12000 }];
    m.consultar.mockResolvedValue({ ...prova, status: "PENDENTE" });
    expect(await cancelarOperacaoInicial("a", "u")).toEqual({ cancelada: false, emConferencia: true });
    expect(m.cancelarCobranca).not.toHaveBeenCalled();
    expect(m.cancelar).not.toHaveBeenCalled();
    expect(m.criar).not.toHaveBeenCalled();
    expect(a.status).toBe("PENDENTE");
    expect(a.operacaoInicial).toBe("CANCELAMENTO_REVISAO");
  });
  it("não envia cancelamento se o provedor não comprovar zero recebido", async () => {
    a.gatewayId = "pixrec_a" as never;
    a.cobrancas = [{ id: "c", gatewayId: "ch_1", status: "PENDENTE", valorCentavos: 12000 }];
    m.consultar.mockResolvedValue({ ...prova, status: "PENDENTE", liquidadoCentavos: undefined });
    expect(await cancelarOperacaoInicial("a", "u")).toEqual({ cancelada: false, emConferencia: true });
    expect(m.cancelarCobranca).not.toHaveBeenCalled(); expect(a.operacaoInicial).toBe("CANCELAMENTO_REVISAO"); expect(a.status).toBe("PENDENTE");
  });
  it("reconfere Pix previamente encerrado com zero recebido e então libera nova adesão", async () => {
    a.gatewayId = "pixrec_a" as never; a.operacaoInicial = "CANCELAMENTO_REVISAO" as never;
    a.cobrancas = [{ id: "c", gatewayId: "ch_1", status: "PENDENTE", valorCentavos: 12000 }];
    expect((await cancelarOperacaoInicial("a", "u")).cancelada).toBe(true);
    expect(a.status).toBe("CANCELADA"); expect(a.operacaoInicial).toBeNull(); expect(m.cancelar).not.toHaveBeenCalled();
  });
  it("mantém o Pix original quando ele continua aberto, válido e sem recebimento", async () => {
    a.gatewayId = "pixrec_a" as never; a.operacaoInicial = "CANCELAMENTO_REVISAO" as never;
    a.cobrancas = [{ id: "c", gatewayId: "ch_1", status: "PENDENTE", valorCentavos: 12000 }];
    m.consultar.mockResolvedValue({ ...prova, status: "PENDENTE", forma: "PIX", expiraEm: new Date(Date.now() + 60_000).toISOString() });
    expect(await manterOperacaoInicial("a", "u")).toEqual({ mantida: true });
    expect(a.operacaoInicial).toBeNull(); expect(a.status).toBe("PENDENTE"); expect(m.cancelarCobranca).not.toHaveBeenCalled(); expect(m.audit).toHaveBeenCalledTimes(2);
  });
  it.each([null, "2000-01-01T00:00:00Z"])("não reabre Pix vencido ou com validade desconhecida (%s)", async expiraEm => {
    a.gatewayId = "pixrec_a" as never; a.operacaoInicial = "CANCELAMENTO_REVISAO" as never;
    a.cobrancas = [{ id: "c", gatewayId: "ch_1", status: "PENDENTE", valorCentavos: 12000 }];
    m.consultar.mockResolvedValue({ ...prova, status: "PENDENTE", forma: "PIX", expiraEm });
    await expect(manterOperacaoInicial("a", "u")).rejects.toMatchObject({ codigo: "assinatura_operacao_revisao" });
    expect(m.atualizarMuitas).toHaveBeenCalledWith({ where: { id: "a", operacaoInicial: "MANTENDO" }, data: { operacaoInicial: "CANCELAMENTO_REVISAO" } });
  });
  it("mantém somente um Pix aberto e aceita cobranças antigas comprovadamente encerradas", async () => {
    Object.assign(a, { gatewayId: "pixrec_a", operacaoInicial: "CANCELAMENTO_REVISAO" });
    const aberta = { id: "c", gatewayId: "ch_1", status: "PENDENTE", valorCentavos: 12000 };
    a.cobrancas = [aberta, { ...aberta, id: "antiga", gatewayId: "ch_antiga" }];
    await expect(manterOperacaoInicial("a", "u")).rejects.toMatchObject({ codigo: "assinatura_operacao_revisao" });
    expect(m.consultar).not.toHaveBeenCalled();
    a.cobrancas[1].status = "CANCELADA";
    m.consultar.mockResolvedValueOnce({ ...prova, status: "PENDENTE", forma: "PIX", expiraEm: "2099-01-01T00:00:00Z" })
      .mockResolvedValueOnce({ ...prova, id: "ch_antiga" });
    await expect(manterOperacaoInicial("a", "u")).resolves.toEqual({ mantida: true });
    expect(a.operacaoInicial).toBeNull();
  });
  it("preserva a conferência se a cobrança mudar enquanto o provedor responde", async () => {
    Object.assign(a, { gatewayId: "pixrec_a", operacaoInicial: "CANCELAMENTO_REVISAO" });
    a.cobrancas = [{ id: "c", gatewayId: "ch_1", status: "PENDENTE", valorCentavos: 12000 }];
    m.consultar.mockImplementationOnce(async () => {
      a.cobrancas[0].status = "CANCELADA";
      return { ...prova, status: "PENDENTE", forma: "PIX", expiraEm: "2099-01-01T00:00:00Z" };
    });
    await expect(manterOperacaoInicial("a", "u")).rejects.toMatchObject({ codigo: "assinatura_operacao_revisao" });
    expect(a.operacaoInicial).toBe("CANCELAMENTO_REVISAO");
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
