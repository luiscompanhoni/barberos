import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: {} }));
import { apresentarPrevia } from "@/lib/conciliacao/historico/consulta";
import type { EscolhaHistorico } from "@/lib/conciliacao/historico/schemas";

const p: EscolhaHistorico = { transacaoId: "91001", assinaturaId: "ass", operacao: "IMPORTAR", motivo: "Evidência sintética conferida", identidadeConfirmada: false };
function contexto() {
  return {
    fonte: { id: "91001", contratoId: "101", valorCentavos: 11800, vencimento: "2026-10-01", status: "captured", pagamentoEfetivoEm: null as string | null, cliente: { nome: "Pessoa sintética", cpf: "", telefones: ["11999990001"] } },
    assinatura: { id: "ass", clienteId: "cli", status: "CANCELADA", gatewayId: "celcash:hist:cli", cliente: { id: "cli", nome: "Pessoa sintética", cpf: null, telefone: "5511999990001" } },
    movimentos: [{ id: "mov", idExterno: "saldo-101", bruto: {}, fonte: "CELCASH", tipo: "RECEBIMENTO", transacaoId: "91001", valorCentavos: 11800, data: new Date("2026-11-03T13:30:00Z") }],
    cobrancas: [], canonicas: [], vinculos: [], pedidos: [], clientesMesmoCpf: [],
    backup: { id: "backup", restaurado: true, erro: null, criadoEm: new Date(), bytes: BigInt(1024) },
  } as unknown as Parameters<typeof apresentarPrevia>[1];
}

describe("prévia comunica a situação real da receita histórica", () => {
  it("bloqueia inclusão sem data efetiva antes do botão aplicar", () => {
    const r = apresentarPrevia(p, contexto());
    expect(r.podeAplicar).toBe(false); expect(r.bloqueios).toContainEqual(expect.stringContaining("Recebimento pendente"));
    expect(r.depois.pagamentoEfetivoEm).toBeNull();
  });
  it("permite vínculo pendente e mostra as datas de legado e recebimento separadamente", () => {
    const c = contexto();
    const pagaEm = c.movimentos[0].data;
    c.cobrancas.push({ id: "legada", assinaturaId: "ass", gatewayId: "cashbarber:pag:legada", valorCentavos: 11800, vencimento: new Date("2026-10-01"), status: "PAGA", pagaEm, atualizadaEm: pagaEm,
      valorRecebidoConfirmadoCentavos: null, recebidoConfirmadoEm: null, provaRecebimento: null, recebimentoPendente: null });
    const escolha = { ...p, operacao: "VINCULAR" as const, cobrancaId: "legada" };
    const pendente = apresentarPrevia(escolha, c);
    expect(pendente.podeAplicar).toBe(true); expect(pendente.avisos).toContainEqual(expect.stringContaining("Recebimento pendente"));
    expect(pendente.depois.pagaEm).toBe(pagaEm.toISOString());
    c.fonte.pagamentoEfetivoEm = "2026-11-02T13:30:00.000Z";
    const comprovada = apresentarPrevia(escolha, c);
    expect(comprovada.depois.recebimentoPendente).toBeNull();
    expect(comprovada.depois.pagamentoEfetivoEm).toBe(c.fonte.pagamentoEfetivoEm);
    expect(comprovada.depois.pagaEm).toBe(pagaEm.toISOString());
  });
  it("mantém a prova anterior íntegra na prévia quando a leitura atual omite a data", () => {
    const c = contexto(), pagaEm = c.movimentos[0].data, recebidoConfirmadoEm = new Date("2026-11-02T13:30:00Z"), gatewayId = "celtx_91001";
    c.cobrancas.push({ id: "legada", assinaturaId: "ass", gatewayId, valorCentavos: 11800, vencimento: new Date("2026-10-01"), status: "PAGA", pagaEm, atualizadaEm: pagaEm,
      valorRecebidoConfirmadoCentavos: 11800, recebidoConfirmadoEm, recebimentoPendente: null,
      provaRecebimento: { versao: 1, fonte: "celcash", referencia: gatewayId, status: "captured", campoValor: "Transactions.value", campoData: "Transactions.paydayDateDateTime", em: recebidoConfirmadoEm.toISOString(), valorCentavos: 11800 } });
    const escolha = { ...p, operacao: "VINCULAR" as const, cobrancaId: "legada" }, antes = structuredClone(c.cobrancas[0]);
    const r = apresentarPrevia(escolha, c);
    expect(r.podeAplicar).toBe(true); expect(r.depois.recebimentoComprovado).toBe(true);
    expect(r.depois.recebimentoPendente).toBeNull(); expect(r.depois.pagamentoEfetivoEm).toBe(recebidoConfirmadoEm.toISOString());
    expect(r.avisos).not.toContainEqual(expect.stringContaining("Recebimento pendente"));
    expect(c.cobrancas[0]).toEqual(antes);
    c.cobrancas[0].recebimentoPendente = "Conferência anterior ainda aberta";
    const pendente = apresentarPrevia(escolha, c);
    expect(pendente.depois.recebimentoComprovado).toBe(false); expect(pendente.depois.recebimentoPendente).toBe("Conferência anterior ainda aberta");
    expect(pendente.revisao).not.toBe(r.revisao);
  });
  it("bloqueia a prévia que tenta associar prova de outro gateway ao crédito Celcash", () => {
    const c = contexto(), pagaEm = c.movimentos[0].data, gatewayId = "cashbarber:pag:legada";
    c.fonte.pagamentoEfetivoEm = "2026-11-02T13:30:00.000Z";
    c.cobrancas.push({ id: "legada", assinaturaId: "ass", gatewayId, valorCentavos: 11800, vencimento: new Date("2026-10-01"), status: "PAGA", pagaEm, atualizadaEm: pagaEm,
      valorRecebidoConfirmadoCentavos: 11800, recebidoConfirmadoEm: new Date(c.fonte.pagamentoEfetivoEm), recebimentoPendente: null,
      provaRecebimento: { versao: 1, fonte: "pagarme", referencia: gatewayId, status: "paid", campoValor: "charge.paid_amount", campoData: "charge.paid_at", em: c.fonte.pagamentoEfetivoEm, valorCentavos: 11800 } });
    const r = apresentarPrevia({ ...p, operacao: "VINCULAR", cobrancaId: "legada" }, c);
    expect(r.podeAplicar).toBe(false); expect(r.bloqueios).toContainEqual(expect.stringContaining("origem"));
    expect(r.depois.recebimentoComprovado).toBe(false);
    expect(JSON.stringify(r)).not.toContain("charge.paid_amount");
  });
});
