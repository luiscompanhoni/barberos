import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ cliente: vi.fn(), assinaturas: vi.fn(), movimentos: vi.fn(), vinculo: vi.fn(), assinatura: vi.fn(), cobrancas: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  cliente: { findMany: m.cliente }, assinatura: { findMany: m.assinaturas, findUnique: m.assinatura },
  movimentoExterno: { findMany: m.movimentos }, cobranca: { findMany: m.cobrancas },
  vinculoCobrancaExterna: { findUnique: m.vinculo, findMany: async () => [] },
  backupRegistro: { findFirst: async () => null }, pedidoEstorno: { findMany: async () => [] },
} }));
vi.mock("@/lib/conciliacao/historico/fonte", () => ({ buscarTransacaoHistorica: async () => ({ id: "91001", contratoId: "101", valorCentavos: 11800, vencimento: "2026-10-01", status: "captured", cliente: { nome: "Pessoa sintética", cpf: "", telefones: [] } }) }));
import { consultarHistorico, contextoHistorico } from "@/lib/conciliacao/historico/consulta";
import { db } from "@/lib/db";

beforeEach(() => {
  vi.clearAllMocks();
  const data = new Date("2026-11-03T13:30:00Z");
  m.cliente.mockResolvedValue([{ id: "cli", nome: "Pessoa sintética", telefone: "sintetico", cpf: null }]);
  const cobranca = { id: "cob", assinaturaId: "ass", gatewayId: "celtx_91001", valorCentavos: 11800, status: "PAGA", vencimento: data, pagaEm: data, atualizadaEm: data,
    provaRecebimento: { sentinelaPrivada: "PROVA_INTERNA" }, recebimentoPendente: "PENDENCIA_INTERNA", valorRecebidoConfirmadoCentavos: 11800, recebidoConfirmadoEm: data };
  m.assinaturas.mockResolvedValue([{ id: "ass", clienteId: "cli", status: "CANCELADA", gatewayId: "celsub_101", plano: { nome: "Plano sintético" }, cobrancas: [cobranca] }]);
  m.assinatura.mockResolvedValue({ id: "ass", clienteId: "cli", status: "CANCELADA", gatewayId: "celsub_101", cliente: { id: "cli", nome: "Pessoa sintética", telefone: "sintetico", cpf: null } });
  m.cobrancas.mockResolvedValue([cobranca]);
  m.movimentos.mockResolvedValue([{ id: "mov", idExterno: "saldo-101", fonte: "CELCASH", transacaoId: "91001", tipo: "RECEBIMENTO", valorCentavos: 11800, data, bruto: { sentinelaPrivada: "BRUTO_INTERNO" } }]);
  m.vinculo.mockResolvedValue(null);
});

describe("evidência histórica interna e DTO restrito", () => {
  it("consulta de tela não pede nem serializa prova completa ou bruto do extrato", async () => {
    const r = await consultarHistorico("91001", "cli"), texto = JSON.stringify(r);
    expect(texto).not.toContain("PROVA_INTERNA"); expect(texto).not.toContain("BRUTO_INTERNO"); expect(texto).not.toContain("PENDENCIA_INTERNA");
    expect(r.assinaturas[0].cobrancas[0]).not.toHaveProperty("provaRecebimento");
    expect(r.movimentos[0]).not.toHaveProperty("bruto");
    expect(m.assinaturas.mock.calls[0][0].select.cobrancas.select).not.toHaveProperty("provaRecebimento");
    expect(m.movimentos.mock.calls[0][0].select).not.toHaveProperty("bruto");
  });
  it("contexto de domínio carrega a evidência necessária para a mesma validação da aplicação", async () => {
    const fonte = { id: "91001", contratoId: "101", valorCentavos: 11800, vencimento: "2026-10-01", status: "captured", cliente: { nome: "Pessoa sintética", cpf: "", telefones: [] } };
    const c = await contextoHistorico(db, fonte, "ass");
    expect(c.cobrancas[0].provaRecebimento).toEqual({ sentinelaPrivada: "PROVA_INTERNA" });
    expect(m.cobrancas.mock.calls[0][0].select).toMatchObject({ provaRecebimento: true, recebidoConfirmadoEm: true, recebimentoPendente: true });
    expect(m.movimentos.mock.calls[0][0].select).toMatchObject({ idExterno: true, bruto: true });
  });
});
