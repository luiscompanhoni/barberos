import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ resumo: vi.fn(), dados: vi.fn(), conferidas: vi.fn() }));
vi.mock("@/lib/db", () => {
  const tx = { movimentoExterno: { groupBy: async () => [] }, taxaRecebimento: { findMany: async () => [] }, vinculoCobrancaExterna: { findMany: async () => [] }, conferenciaExtrato: { findMany: m.conferidas } };
  return { db: { $transaction: (fn: (c: typeof tx) => unknown) => fn(tx) } };
});
vi.mock("@/lib/financeiro/conciliacao", () => ({ taxas: async () => [] }));
vi.mock("@/lib/financeiro/resumo", () => ({ resumoMes: m.resumo }));
vi.mock("@/lib/conciliacao/despesas-conferencia", () => ({ FONTES_CONFERENCIA: ["CELCASH", "STONE"], dadosConferenciaMes: m.dados }));
import { resultadoDoMes } from "@/lib/conciliacao/resultado";

const resumo = (fontes: Record<string, number>) => ({
  receitas: { total: Object.values(fontes).reduce((s, v) => s + v, 0), mensalidades: { total: Object.values(fontes).reduce((s, v) => s + v, 0), porFonte: fontes, completo: true, pendentes: 0 }, comandas: { total: 0, porForma: {} }, antecipados: { total: 0 }, links: { total: 0 }, estornos: { total: 0 } }, despesas: { total: 0, porCategoria: {} },
});
const fontes = (f: Partial<Record<"celcash" | "pagarme" | "asaas" | "simulado" | "indefinida", number>>) => ({ celcash: 0, pagarme: 0, asaas: 0, simulado: 0, indefinida: 0, ...f });
beforeEach(() => {
  vi.clearAllMocks();
  m.dados.mockResolvedValue({ movimentos: [{ id: "m", fonte: "CELCASH", tipo: "RECEBIMENTO", forma: "PIX", valorCentavos: 10000, categoria: null }], despesas: [], vinculos: [], decisoes: [], periodo: { gte: new Date("2026-10-01T03:00Z"), lt: new Date("2026-11-01T03:00Z") }, porFonte: { CELCASH: { hashDados: "fixture" }, STONE: { hashDados: "fixture" } } });
  m.conferidas.mockResolvedValue(["CELCASH", "STONE"].map(fonte => ({ id: fonte, fonte, hashDados: "fixture", criadoEm: new Date("2026-11-02") })));
});

describe("resultado: cobertura bancária não mistura gateways", () => {
  it.each(["pagarme", "asaas"] as const)("receita %s não compensa recebimento Celcash sem base registrada", async fonte => {
    m.resumo.mockResolvedValue(resumo(fontes({ [fonte]: 10000 })));
    const r = await resultadoDoMes("2026-10");
    expect(r.registrado.total).toBe(10000); expect(r.registrado.mensalidades).toBe(10000);
    expect(r.registrado.mensalidadesCelcash).toBe(0);
    expect(r.divergencias.mensalidades).toBe(10000);
    expect(r.status).toBe("PREVIA");
    expect(r.alertas.some(x => x.includes(fonte === "pagarme" ? "Pagar.me" : "Asaas"))).toBe(true);
  });
  it("origens combinadas preservam o total e usam somente a base Celcash na divergência", async () => {
    m.resumo.mockResolvedValue(resumo(fontes({ celcash: 5000, pagarme: 5000 })));
    const r = await resultadoDoMes("2026-10");
    expect(r.registrado.total).toBe(10000); expect(r.divergencias.mensalidades).toBe(5000);
    expect(r.registrado.mensalidadesPorFonte.pagarme).toBe(5000); expect(r.status).toBe("PREVIA");
  });
  it("Celcash comprovada e coberta sem outra pendência permite apenas o estado conciliado", async () => {
    m.resumo.mockResolvedValue(resumo(fontes({ celcash: 10000 })));
    const r = await resultadoDoMes("2026-10");
    expect(r.divergencias.mensalidades).toBe(0); expect(r.status).toBe("CONFERIDO");
  });
  it.each(["simulado", "indefinida"] as const)("receita %s fica separada e mantém a prévia", async fonte => {
    m.resumo.mockResolvedValue(resumo(fontes({ [fonte]: 10000 })));
    const r = await resultadoDoMes("2026-10");
    expect(r.registrado.mensalidadesPorFonte[fonte]).toBe(10000); expect(r.divergencias.mensalidades).toBe(10000); expect(r.status).toBe("PREVIA");
  });
  it("ausência de discriminação nunca presume que toda mensalidade veio da Celcash", async () => {
    const dado = resumo(fontes({ pagarme: 10000 }));
    Reflect.deleteProperty(dado.receitas.mensalidades, "porFonte"); m.resumo.mockResolvedValue(dado);
    const r = await resultadoDoMes("2026-10");
    expect(r.registrado.mensalidadesCelcash).toBe(0); expect(r.registrado.mensalidadesPorFonte.indefinida).toBe(10000); expect(r.status).toBe("PREVIA");
  });
});
