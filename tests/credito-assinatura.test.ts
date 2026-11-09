import type { Assinatura, Beneficio, Cobranca, ReservaCreditoAssinatura } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    $transaction: vi.fn(), $queryRaw: vi.fn(), $executeRaw: vi.fn(),
    assinatura: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn() },
    reservaCreditoAssinatura: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    beneficio: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), updateMany: vi.fn(), aggregate: vi.fn() },
    alteracaoPlanoAssinatura: { findFirst: vi.fn() }, cobranca: { findFirst: vi.fn() }, emissaoPixMensal: { findFirst: vi.fn() },
  },
  antes: vi.fn(), aplicar: vi.fn(), prova: vi.fn(), auditar: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/auditoria", () => ({ auditar: mocks.auditar }));
vi.mock("@/lib/crescimento/credito-assinatura-gateway", () => ({ conferirGatewayAntesDoCredito: mocks.antes, aplicarNoGateway: mocks.aplicar, buscarProvaCobrancaCredito: mocks.prova }));

import { confirmarCreditoNaCobranca, creditoDoCicloParaPix, extratoReservasCredito, reservarCreditoAssinatura, type ProvaCobrancaCredito, type TxCreditoAssinatura } from "@/lib/crescimento/credito-assinatura";

const agora = new Date("2026-11-08T15:00:00Z");
const fonte = { regra: "ASSINATURA_V2", convertidaEm: agora, estornadaEm: null };
type B = Beneficio & { indicacao: typeof fonte | null };
let a: Assinatura, beneficios: B[], reserva: ReservaCreditoAssinatura | null;
let fila: Promise<unknown>;
const tx = mocks.db as unknown as TxCreditoAssinatura;
const cobra = (status: "PENDENTE" | "PAGA" = "PENDENTE") => ({ id: "cob-1", assinaturaId: "a", gatewayId: "ch_1", valorCentavos: 9800, vencimento: new Date("2026-12-15"), status } as Cobranca);
const prova = (status: "PENDENTE" | "PAGA" = "PENDENTE"): ProvaCobrancaCredito => ({ id: "ch_1", assinaturaGatewayId: a.gatewayId!, clienteGatewayId: a.gatewayClienteId!, valorCentavos: 9800, vencimento: "2026-12-15", moeda: "BRL", status, pagoEm: status === "PAGA" ? agora.toISOString() : null, ...(status === "PAGA" ? { liquidadoCentavos: 9800 } : {}) });

beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(agora);
  vi.stubEnv("CREDITOS_MENSALIDADE_ATIVOS", "true"); vi.stubEnv("PAGAMENTOS_PROVIDER", "pagarme");
  a = { id: "a", clienteId: "cliente", status: "ATIVA", gatewayId: "pixrec_a", gatewayClienteId: "cus_1", precoCentavos: 11800, proximoVencimento: new Date("2026-12-15"), pausadaEm: null, encerraEm: null, operacaoInicial: null, descontoRetencaoPct: null, descontoRetencaoAte: null } as Assinatura;
  beneficios = [{ id: "b", clienteId: "cliente", descricao: "Indicação", valorCentavos: 2000, motivo: "INDICOU", indicacaoId: "i", indicacao: fonte, status: "DISPONIVEL", expiraEm: new Date("2026-11-09"), criadoEm: agora, usadoEm: null, reservaCreditoId: null, origemBeneficioId: null } as B];
  reserva = null; fila = Promise.resolve();
  // Serializa transações concorrentes como a trava de cliente/ciclo faria no PostgreSQL.
  mocks.db.$transaction.mockImplementation((fn) => {
    const p = fila.then(() => fn(mocks.db)); fila = p.catch(() => {}); return p;
  });
  mocks.db.assinatura.findUnique.mockImplementation(async () => a);
  mocks.db.assinatura.findUniqueOrThrow.mockImplementation(async () => a);
  mocks.db.assinatura.findMany.mockResolvedValue([]);
  mocks.db.reservaCreditoAssinatura.findUnique.mockImplementation(async () => reserva);
  mocks.db.reservaCreditoAssinatura.findUniqueOrThrow.mockImplementation(async () => reserva);
  mocks.db.reservaCreditoAssinatura.findMany.mockImplementation(async () => reserva ? [reserva] : []);
  mocks.db.reservaCreditoAssinatura.create.mockImplementation(async ({ data }) => (reserva = { ...data, criadoEm: agora, atualizadoEm: agora, cobrancaId: null, gatewayDescontoId: null }));
  mocks.db.reservaCreditoAssinatura.update.mockImplementation(async ({ data }) => Object.assign(reserva!, data));
  mocks.db.reservaCreditoAssinatura.updateMany.mockImplementation(async ({ where, data }) => {
    if (!reserva || (typeof where.estado === "string" && reserva.estado !== where.estado)) return { count: 0 };
    Object.assign(reserva, data); return { count: 1 };
  });
  mocks.db.beneficio.findMany.mockImplementation(async ({ where }) => where.reservaCreditoId ? beneficios.filter((b) => b.reservaCreditoId === where.reservaCreditoId) : beneficios.filter((b) => b.status === "DISPONIVEL" && !!b.expiraEm && b.expiraEm > new Date() && b.indicacao?.regra === "ASSINATURA_V2" && !b.indicacao.estornadaEm));
  mocks.db.beneficio.findUnique.mockImplementation(async ({ where }) => beneficios.find((b) => b.id === where.id));
  mocks.db.beneficio.update.mockImplementation(async ({ where, data }) => Object.assign(beneficios.find((b) => b.id === where.id)!, data));
  mocks.db.beneficio.create.mockImplementation(async ({ data }) => { const b = { ...data, id: "parte", indicacao: null, criadoEm: agora } as B; beneficios.push(b); return b; });
  mocks.db.beneficio.updateMany.mockImplementation(async ({ data }) => { beneficios.filter((b) => b.reservaCreditoId && !b.usadoEm).forEach((b) => Object.assign(b, data)); return { count: 1 }; });
  mocks.db.beneficio.aggregate.mockResolvedValue({ _sum: { valorCentavos: 0 } });
  mocks.antes.mockResolvedValue({}); mocks.aplicar.mockResolvedValue("dis_1");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("reserva de crédito por competência", () => {
  it("flag desligada não consome nem chama provedor; GET ainda mostra reservas", async () => {
    vi.stubEnv("CREDITOS_MENSALIDADE_ATIVOS", "false");
    await expect(reservarCreditoAssinatura("cliente", "a")).rejects.toMatchObject({ codigo: "credito_desativado" });
    expect(mocks.db.reservaCreditoAssinatura.create).not.toHaveBeenCalled(); expect(mocks.antes).not.toHaveBeenCalled();
    expect((await extratoReservasCredito("cliente")).ativa).toBe(false);
  });
  it("confere titular antes de qualquer reserva", async () => {
    await expect(reservarCreditoAssinatura("outra-pessoa", "a")).rejects.toMatchObject({ status: 404 });
    expect(beneficios[0].status).toBe("DISPONIVEL");
  });
  it("duas solicitações concorrentes mantêm uma reserva e uma saída da carteira", async () => {
    const [r1, r2] = await Promise.all([reservarCreditoAssinatura("cliente", "a"), reservarCreditoAssinatura("cliente", "a")]);
    expect(r1.id).toBe(r2.id); expect(mocks.db.reservaCreditoAssinatura.create).toHaveBeenCalledTimes(1);
    expect(mocks.db.beneficio.update).toHaveBeenCalledTimes(1); expect(beneficios[0]).toMatchObject({ status: "USADO", usadoEm: null });
    expect(mocks.db.$queryRaw).toHaveBeenCalled(); expect(mocks.db.$executeRaw).toHaveBeenCalled();
  });
  it("crédito vencido não pode ser solicitado", async () => {
    beneficios[0].expiraEm = agora;
    await expect(reservarCreditoAssinatura("cliente", "a")).rejects.toMatchObject({ codigo: "credito_insuficiente" });
  });
  it("reserva válida preserva ciclo posterior a 30 dias sem estender validade", async () => {
    await reservarCreditoAssinatura("cliente", "a"); vi.setSystemTime(new Date("2026-11-20T15:00Z"));
    const r = await creditoDoCicloParaPix(tx, a, "2026-12-15");
    expect(r).toMatchObject({ valorCentavos: 9800, abatimentoCentavos: 2000 });
    expect(beneficios[0].expiraEm?.toISOString()).toBe("2026-11-09T00:00:00.000Z");
  });
  it("reserva parcial mantém origem e expiry, sem copiar indicacaoId único", async () => {
    await reservarCreditoAssinatura("cliente", "a", 1000);
    expect(beneficios[0]).toMatchObject({ valorCentavos: 1000, status: "DISPONIVEL" });
    expect(beneficios[1]).toMatchObject({ valorCentavos: 1000, status: "USADO", usadoEm: null, origemBeneficioId: "b", expiraEm: beneficios[0].expiraEm });
    expect(beneficios[1].indicacaoId).toBeUndefined();
  });
  it("não inventa cobrança de centavo quando o crédito zeraria a mensalidade", async () => {
    beneficios[0].valorCentavos = 11800;
    await expect(reservarCreditoAssinatura("cliente", "a")).rejects.toMatchObject({ codigo: "credito_gerencia" });
    expect(beneficios[0].status).toBe("DISPONIVEL"); expect(reserva).toBeNull();
  });
  it.each(["cobranca", "emissaoPixMensal", "alteracaoPlanoAssinatura"] as const)("%s em aberto bloqueia antes do débito", async (modelo) => {
    mocks.db[modelo].findFirst.mockResolvedValue({ id: "conflito" });
    await expect(reservarCreditoAssinatura("cliente", "a")).rejects.toMatchObject({ codigo: "credito_gerencia" });
    expect(beneficios[0].status).toBe("DISPONIVEL");
  });
  it("ciclo com valor alterado e origem estornada não emite novo Pix", async () => {
    await reservarCreditoAssinatura("cliente", "a"); a.precoCentavos = 12800;
    await expect(creditoDoCicloParaPix(tx, a, "2026-12-15")).rejects.toMatchObject({ codigo: "credito_gerencia" });
  });
  it("origem estornada bloqueia uso mesmo com crédito já reservado", async () => {
    await reservarCreditoAssinatura("cliente", "a");
    beneficios[0].indicacao = { ...fonte, estornadaEm: agora } as unknown as typeof fonte;
    await expect(creditoDoCicloParaPix(tx, a, "2026-12-15")).rejects.toMatchObject({ codigo: "credito_gerencia" });
    expect(beneficios[0].usadoEm).toBeNull();
  });
  it("desligar a flag com reserva pendente bloqueia emissão e preserva o crédito separado", async () => {
    await reservarCreditoAssinatura("cliente", "a"); vi.stubEnv("CREDITOS_MENSALIDADE_ATIVOS", "false");
    await expect(creditoDoCicloParaPix(tx, a, "2026-12-15")).rejects.toMatchObject({ codigo: "credito_gerencia" });
    expect(beneficios[0]).toMatchObject({ status: "USADO", usadoEm: null });
    expect((await extratoReservasCredito("cliente")).reservas).toHaveLength(1);
  });
  it("timeout externo mantém reserva em revisão e não repete POST em nova solicitação", async () => {
    a.gatewayId = "sub_1"; mocks.aplicar.mockRejectedValue(new Error("timeout"));
    await expect(reservarCreditoAssinatura("cliente", "a")).rejects.toMatchObject({ codigo: "credito_gerencia" });
    expect(reserva!.estado).toBe("REVISAO"); expect(beneficios[0]).toMatchObject({ status: "USADO", usadoEm: null });
    await reservarCreditoAssinatura("cliente", "a"); expect(mocks.aplicar).toHaveBeenCalledTimes(1);
  });
});

describe("confirmação exige prova monetária e pagamento", () => {
  beforeEach(async () => { await reservarCreditoAssinatura("cliente", "a"); });
  it("fatura emitida não gasta definitivamente o crédito", async () => {
    const r = await confirmarCreditoNaCobranca(cobra(), prova());
    expect(r?.estado).toBe("CONFIRMADA"); expect(beneficios[0].usadoEm).toBeNull();
    expect(reserva!.cobrancaId).toBe("cob-1");
  });
  it("pagamento provado consome uma vez; webhook repetido não duplica", async () => {
    await confirmarCreditoNaCobranca(cobra("PAGA"), prova("PAGA"));
    await confirmarCreditoNaCobranca(cobra("PAGA"), prova("PAGA"));
    expect(reserva!.estado).toBe("APLICADA"); expect(beneficios[0].usadoEm).toEqual(agora);
    expect(mocks.db.beneficio.updateMany).toHaveBeenCalledTimes(1);
  });
  it.each([
    { moeda: "USD" }, { valorCentavos: 1 }, { vencimento: "2026-12-16" },
    { clienteGatewayId: "cus_outro" }, { assinaturaGatewayId: "pixrec_outra" },
    { id: "ch_outro" }, { status: "PAGA", pagoEm: null },
  ])("prova divergente %j mantém revisão e nenhum uso definitivo", async (extra) => {
    await expect(confirmarCreditoNaCobranca(cobra(), { ...prova(), ...extra } as ProvaCobrancaCredito)).rejects.toMatchObject({ codigo: "credito_gerencia" });
    expect(reserva!.estado).toBe("REVISAO"); expect(beneficios[0].usadoEm).toBeNull();
  });
  it("prova de pago sem valor líquido não consome", async () => {
    await expect(confirmarCreditoNaCobranca(cobra("PAGA"), { ...prova("PAGA"), liquidadoCentavos: undefined })).rejects.toMatchObject({ codigo: "credito_gerencia" });
    expect(beneficios[0].usadoEm).toBeNull();
  });
  it("mudança concorrente de estado não é sobrescrita por confirmação", async () => {
    mocks.db.reservaCreditoAssinatura.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(confirmarCreditoNaCobranca(cobra("PAGA"), prova("PAGA"))).rejects.toMatchObject({ codigo: "credito_gerencia" });
    expect(beneficios[0].usadoEm).toBeNull(); expect(reserva!.estado).toBe("REVISAO");
  });
  it("sem prova passada faz consulta própria e falha fechada se ela não confirmar", async () => {
    mocks.prova.mockRejectedValue(new Error("sem moeda"));
    await expect(confirmarCreditoNaCobranca(cobra())).rejects.toMatchObject({ codigo: "credito_gerencia" });
    expect(mocks.prova).toHaveBeenCalledTimes(1); expect(beneficios[0].usadoEm).toBeNull();
  });
});
