import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Sessao } from "@/lib/auth/sessao";
const m = vi.hoisted(() => ({
  estado: { cobrancas: [] as Record<string, unknown>[], vinculos: [] as Record<string, unknown>[], auditorias: [] as unknown[] },
  fonte: {} as Record<string, unknown>, movimento: {} as Record<string, unknown>,
  contexto: vi.fn(), auditoria: vi.fn(), criar: vi.fn(), atualizar: vi.fn(), consultar: vi.fn(),
}));
vi.mock("@/lib/conciliacao/historico/fonte", () => ({ buscarTransacaoHistorica: async () => m.fonte }));
vi.mock("@/lib/conciliacao/historico/consulta", () => ({ contextoHistorico: m.contexto, revisaoHistorico: () => "a".repeat(64), chaveEscolhaHistorico: () => "b".repeat(64) }));
vi.mock("@/lib/auditoria", () => ({ auditar: m.auditoria }));
vi.mock("@/lib/db", () => {
  const cobranca = { create: m.criar, update: m.atualizar, findUniqueOrThrow: m.consultar, findMany: async () => m.estado.cobrancas };
  const tx = {
    $executeRaw: vi.fn(), $queryRaw: vi.fn(), cobranca,
    assinatura: { findUnique: async () => ({ clienteId: "cli" }) },
    movimentoExterno: { findUniqueOrThrow: async () => m.movimento },
    vinculoCobrancaExterna: {
      create: async ({ data }: { data: Record<string, unknown> }) => { const v = { id: "vinculo", ...data }; m.estado.vinculos.push(v); return v; },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const v = m.estado.vinculos.find(x => x.id === where.id)!; Object.assign(v, data); return v;
      },
    },
  };
  return { db: { cobranca, $transaction: async (fn: (t: unknown) => Promise<unknown>) => {
    const antes = structuredClone(m.estado);
    try { return await fn(tx); } catch (e) { m.estado = antes; throw e; }
  } } };
});
import { aplicarHistorico } from "@/lib/conciliacao/historico/aplicar";
import { recebimentosMensalidades } from "@/lib/financeiro/recebimentos";

const s: Sessao = { usuarioId: "dono", nome: "Dono sintético", papel: "DONO", clienteId: null, barbeiroId: null };
const entrada = { transacaoId: "91001", assinaturaId: "ass", operacao: "IMPORTAR" as const, motivo: "Crédito sintético conferido", identidadeConfirmada: false, revisao: "a".repeat(64), backupId: "backup" };
const instante = new Date("2026-11-03T13:30:00Z");
const janela = { gte: new Date("2026-11-01T03:00Z"), lt: new Date("2026-12-01T03:00Z") };
const legado = () => ({ id: "legada", assinaturaId: "ass", gatewayId: "cashbarber:pag:legado", valorCentavos: 11800, vencimento: new Date("2026-10-01Z"), pagaEm: instante, status: "PAGA", atualizadaEm: instante, valorRecebidoConfirmadoCentavos: null, recebidoConfirmadoEm: null, provaRecebimento: null, recebimentoPendente: null, assinatura: { clienteId: "cli" } });
beforeEach(() => {
  vi.clearAllMocks();
  m.estado = { cobrancas: [], vinculos: [], auditorias: [] };
  m.fonte = { id: entrada.transacaoId, contratoId: "101", valorCentavos: 11800, vencimento: "2026-10-01", status: "captured", pagamentoEfetivoEm: "2026-11-02T13:30:00.000Z", cliente: { nome: "Pessoa sintética", cpf: "", telefones: ["11999990001"] } };
  m.movimento = { id: "mov", idExterno: "saldo-101", fonte: "CELCASH", tipo: "RECEBIMENTO", transacaoId: entrada.transacaoId, valorCentavos: 11800, data: instante, bruto: {} };
  m.criar.mockImplementation(async ({ data }) => { const c = { ...legado(), id: "importada", ...data }; m.estado.cobrancas.push(c); return structuredClone(c); });
  m.atualizar.mockImplementation(async ({ where, data }) => { const c = m.estado.cobrancas.find(x => x.id === where.id)!; Object.assign(c, data); return structuredClone(c); });
  m.consultar.mockImplementation(async ({ where }) => structuredClone(m.estado.cobrancas.find(x => x.id === where.id)!));
  m.auditoria.mockImplementation(async (...args: unknown[]) => { m.estado.auditorias.push(args.slice(1)); });
  m.contexto.mockImplementation(async () => ({
    fonte: m.fonte, assinatura: { id: "ass", clienteId: "cli", status: "CANCELADA", gatewayId: "celcash:hist:cli", cliente: { id: "cli", nome: "Pessoa sintética", cpf: null, telefone: "5511999990001" } },
    movimentos: [m.movimento], cobrancas: m.estado.cobrancas, canonicas: [], vinculos: m.estado.vinculos, pedidos: [], clientesMesmoCpf: [],
    backup: { id: "backup", restaurado: true, erro: null, criadoEm: new Date(), bytes: BigInt(1024) },
  }));
});

describe("aplicar correção histórica com prova monetária", () => {
  it("importação entra uma vez na receita; replay não duplica cobrança, extrato nem auditoria", async () => {
    const primeiro = await aplicarHistorico(s, entrada);
    expect(primeiro).toMatchObject({ repetida: false, recebimentoComprovado: true });
    expect((await recebimentosMensalidades(janela)).total).toBe(11800);
    expect(await aplicarHistorico(s, entrada)).toMatchObject({ repetida: true, recebimentoComprovado: true });
    expect(m.estado.cobrancas).toHaveLength(1); expect(m.estado.vinculos).toHaveLength(1); expect(m.estado.auditorias).toHaveLength(1);
    expect(m.movimento).toMatchObject({ valorCentavos: 11800, data: instante });
    expect(m.estado.cobrancas[0]).toMatchObject({ pagaEm: instante, recebidoConfirmadoEm: new Date("2026-11-02T13:30:00Z"), provaRecebimento: { fonteGateway: "celcash" } });
  });
  it("vincula o legado sem trocar suas datas/nominal e reconhece uma única receita", async () => {
    m.estado.cobrancas.push(legado()); const antes = structuredClone(m.estado.cobrancas[0]);
    const r = await aplicarHistorico(s, { ...entrada, operacao: "VINCULAR", cobrancaId: "legada" });
    expect(r.recebimentoComprovado).toBe(true); expect(m.criar).not.toHaveBeenCalled();
    expect(m.estado.cobrancas[0]).toMatchObject({ gatewayId: antes.gatewayId, pagaEm: antes.pagaEm, vencimento: antes.vencimento, valorCentavos: antes.valorCentavos });
    expect((await recebimentosMensalidades(janela)).total).toBe(11800);
  });
  it("falta de data bloqueia importação; vínculo permanece pendente sem prova nova", async () => {
    m.fonte.pagamentoEfetivoEm = null;
    await expect(aplicarHistorico(s, entrada)).rejects.toMatchObject({ status: 409, codigo: "recebimento_historico_pendente" });
    expect(m.estado.cobrancas).toHaveLength(0);
    m.estado.cobrancas.push(legado());
    const r = await aplicarHistorico(s, { ...entrada, operacao: "VINCULAR", cobrancaId: "legada" });
    expect(r.recebimentoComprovado).toBe(false); expect(r.recebimentoPendente).toContain("data efetiva");
    expect((await recebimentosMensalidades(janela)).total).toBe(0);
    expect(m.estado.cobrancas[0].provaRecebimento).toBeNull();
  });
  it("falha da auditoria reverte cobrança, prova e vínculo na mesma transação", async () => {
    m.auditoria.mockRejectedValueOnce(new Error("auditoria-indisponivel"));
    await expect(aplicarHistorico(s, entrada)).rejects.toThrow("auditoria-indisponivel");
    expect(m.estado).toEqual({ cobrancas: [], vinculos: [], auditorias: [] });
  });
});
