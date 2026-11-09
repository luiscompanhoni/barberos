import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  $queryRaw: vi.fn(), $executeRaw: vi.fn(), indicacao: { findUnique: vi.fn(), aggregate: vi.fn(), create: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  assinatura: { findMany: vi.fn() }, cobranca: { findFirst: vi.fn(), findUnique: vi.fn() },
  beneficio: { createMany: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() }, reservaCreditoAssinatura: { updateMany: vi.fn() }, prova: vi.fn(), auditar: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { ...m, $transaction: (fn: (tx: typeof m) => unknown) => fn(m) } }));
vi.mock("@/lib/auditoria", () => ({ auditar: m.auditar }));
vi.mock("@/lib/pagamentos/gateway", () => ({ gatewayPorId: async () => ({ buscarCobranca: m.prova }) }));
import { converterIndicacoesAssinatura, registrarIndicacaoAssinatura, revisarIndicacaoEstornada } from "@/lib/crescimento/indicacao-assinatura";
import { elegivelIndicacaoAssinatura, indicacaoAssinaturaHabilitada, limiteIndicacaoAssinatura, validadeIndicacao } from "@/lib/crescimento/indicacao-assinatura-regras";

const agora = new Date("2026-11-08T15:00:00Z");
const dono = { id: "indicador", nome: "Cliente", telefone: "telefone-sintetico" };
const ind = { id: "ind1", indicadorId: "indicador", indicadoId: "amigo", criadoEm: agora, premioIndicadorCentavos: 2000, premioIndicadoCentavos: 1000, indicador: dono, indicado: { nome: "Amigo" } };
const cob = { id: "c1", gatewayId: "ch_teste", valorCentavos: 11800, status: "PAGA", assinatura: { gatewayId: "sub_teste", status: "ATIVA" } };

beforeEach(() => {
  vi.resetAllMocks(); vi.unstubAllEnvs();
  vi.useFakeTimers(); vi.setSystemTime(agora);
  m.indicacao.findUnique.mockResolvedValue(null); m.indicacao.aggregate.mockResolvedValue({ _sum: { premioIndicadorCentavos: 0, premioIndicadoCentavos: 0 } });
  m.indicacao.create.mockResolvedValue(ind); m.assinatura.findMany.mockResolvedValue([]); m.indicacao.findMany.mockResolvedValue([ind]);
  m.cobranca.findFirst.mockResolvedValue(cob); m.cobranca.findUnique.mockResolvedValue(cob); m.indicacao.updateMany.mockResolvedValue({ count: 1 });
  m.prova.mockResolvedValue({ id: "ch_teste", status: "PAGA", valorCentavos: 11800, pagaEm: agora.toISOString(), assinaturaGatewayId: "sub_teste" });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("elegibilidade e teto de indicação", () => {
  it("fica desligada e sem verba até configuração explícita", () => {
    expect(indicacaoAssinaturaHabilitada()).toBe(false); expect(limiteIndicacaoAssinatura()).toBe(0);
    vi.stubEnv("INDICACAO_ASSINATURA_LIMITE_CENTAVOS", "9007199254740992"); expect(limiteIndicacaoAssinatura()).toBe(0);
  });
  it("admite quem nunca assinou, mesmo tendo feito cortes; exige 90 dias sem plano", () => {
    expect(elegivelIndicacaoAssinatura([], agora)).toBe(true);
    const encerrado = (dias: number) => ({ status: "CANCELADA", canceladaEm: new Date(+agora - dias * 86_400_000), encerraEm: null });
    expect(elegivelIndicacaoAssinatura([encerrado(90)], agora)).toBe(true);
    expect(elegivelIndicacaoAssinatura([encerrado(89)], agora)).toBe(false);
    expect(elegivelIndicacaoAssinatura([{ ...encerrado(100), status: "ATIVA" }], agora)).toBe(false);
    expect(elegivelIndicacaoAssinatura([{ ...encerrado(100), encerraEm: new Date(+agora - 80 * 86_400_000) }], agora)).toBe(false);
    expect(elegivelIndicacaoAssinatura([{ status: "CANCELADA", canceladaEm: null, encerraEm: null }], agora)).toBe(false);
  });
  it("reserva R$30 no teto e não entrega crédito só por cadastrar", async () => {
    vi.stubEnv("INDICACAO_ASSINATURA_LIMITE_CENTAVOS", "3000");
    const r = await registrarIndicacaoAssinatura("amigo", dono, "SITE");
    expect(r.aguardandoPagamento).toBe(true); expect(r.premioCentavos).toBe(0); expect(m.beneficio.createMany).not.toHaveBeenCalled();
    expect(m.indicacao.create.mock.calls[0][0].data).toMatchObject({ regra: "ASSINATURA_V2", premioIndicadorCentavos: 2000, premioIndicadoCentavos: 1000 });
  });
  it("conta compromissos ainda não resgatados e bloqueia sem orçamento", async () => {
    vi.stubEnv("INDICACAO_ASSINATURA_LIMITE_CENTAVOS", "6000");
    m.indicacao.aggregate.mockResolvedValue({ _sum: { premioIndicadorCentavos: 4000, premioIndicadoCentavos: 2000 } });
    await expect(registrarIndicacaoAssinatura("amigo", dono, "BOT")).rejects.toThrow(/limite/);
    expect(m.indicacao.create).not.toHaveBeenCalled();
  });
  it("não permite indicação anterior nem contrato vigente", async () => {
    m.indicacao.findUnique.mockResolvedValue({ id: "anterior" });
    await expect(registrarIndicacaoAssinatura("amigo", dono, "SITE")).rejects.toThrow(/já tem/);
    m.indicacao.findUnique.mockResolvedValue(null); m.assinatura.findMany.mockResolvedValue([{ status: "ATRASADA", canceladaEm: null, encerraEm: null }]);
    await expect(registrarIndicacaoAssinatura("amigo", dono, "SITE")).rejects.toThrow(/90 dias/);
  });
});

describe("primeiro pagamento confirmado", () => {
  it("pagamento consultado e revalidado libera os dois créditos por 30 dias", async () => {
    const r = await converterIndicacoesAssinatura();
    expect(m.prova).toHaveBeenCalledWith("ch_teste"); expect(r).toHaveLength(1);
    const creditos = m.beneficio.createMany.mock.calls[0][0].data;
    expect(creditos.map((b: { valorCentavos: number }) => b.valorCentavos)).toEqual([2000, 1000]);
    expect(+creditos[0].expiraEm - +m.indicacao.updateMany.mock.calls[0][0].data.convertidaEm).toBe(30 * 86_400_000);
    expect(m.cobranca.findFirst.mock.calls[0][0].where.assinatura.migracao).toBeNull();
  });
  it.each([
    { id: "ch_outra" }, { status: "PENDENTE" }, { assinaturaGatewayId: "sub_outra" }, { valorCentavos: 100 }, { pagaEm: null }, { pagaEm: "inválida" }, { pagaEm: "2026-11-07T15:00:00Z" }, { pagaEm: "2099-01-01T00:00:00Z" },
  ])("não concede com prova divergente %j", async (erro) => {
    m.prova.mockResolvedValue({ id: "ch_teste", status: "PAGA", valorCentavos: 11800, pagaEm: agora.toISOString(), assinaturaGatewayId: "sub_teste", ...erro });
    expect(await converterIndicacoesAssinatura()).toEqual([]); expect(m.beneficio.createMany).not.toHaveBeenCalled();
  });
  it("não usa visita, cobrança legada ou falha de consulta como conversão", async () => {
    m.cobranca.findFirst.mockResolvedValue(null); expect(await converterIndicacoesAssinatura()).toEqual([]);
    m.cobranca.findFirst.mockResolvedValue({ ...cob, assinatura: { gatewayId: "celsub_antigo" } }); expect(await converterIndicacoesAssinatura()).toEqual([]);
    m.cobranca.findFirst.mockResolvedValue(cob); m.prova.mockRejectedValue(new Error("offline")); expect(await converterIndicacoesAssinatura()).toEqual([]);
    expect(m.beneficio.createMany).not.toHaveBeenCalled();
  });
  it("a condição atômica evita repetir a concessão em duas rodadas", async () => {
    let convertida = false;
    m.indicacao.updateMany.mockImplementation(async () => { if (convertida) return { count: 0 }; convertida = true; return { count: 1 }; });
    await Promise.all([converterIndicacoesAssinatura(), converterIndicacoesAssinatura()]);
    expect(m.beneficio.createMany).toHaveBeenCalledTimes(1);
  });
  it("revalida após a consulta para não conceder pagamento estornado na corrida", async () => {
    m.cobranca.findUnique.mockResolvedValue({ ...cob, status: "ESTORNADA" });
    expect(await converterIndicacoesAssinatura()).toEqual([]); expect(m.beneficio.createMany).not.toHaveBeenCalled();
  });
  it("validade começa na concessão, sem inventar saque", () => {
    expect(validadeIndicacao(agora).toISOString()).toBe("2026-12-08T15:00:00.000Z");
  });
  it("estorno cancela saldo disponível, retém reserva para revisão e não cria débito", async () => {
    m.indicacao.findUnique.mockResolvedValue({ ...ind, beneficios: [{ id: "orig" }], estornadaEm: null });
    m.beneficio.findMany.mockResolvedValue([{ id: "orig", status: "DISPONIVEL", reservaCreditoId: null }, { id: "parte", status: "USADO", reservaCreditoId: "reserva" }]);
    await revisarIndicacaoEstornada("c1");
    expect(m.beneficio.updateMany.mock.calls[0][0].data.status).toBe("CANCELADO");
    expect(m.reservaCreditoAssinatura.updateMany.mock.calls[0][0].data.estado).toBe("REVISAO");
    expect(m.beneficio.createMany).not.toHaveBeenCalled(); expect(m.prova).not.toHaveBeenCalled();
  });
});
