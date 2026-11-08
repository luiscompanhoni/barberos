import { describe, expect, it } from "vitest";
import { prepararRecebimentoHistorico } from "@/lib/conciliacao/historico/recebimento";
import { provaRecebimentoValida } from "@/lib/pagamentos/recebimento";
import type { TransacaoHistorica } from "@/lib/conciliacao/historico/schemas";

const fonte: TransacaoHistorica = { id: "91001", contratoId: "101", valorCentavos: 11800, vencimento: "2026-10-01", status: "captured", pagamentoEfetivoEm: "2026-11-02T13:30:00.000Z", cliente: { nome: "Pessoa sintética", cpf: "", telefones: [] } };
const movimento = { id: "mov", idExterno: "saldo-101", fonte: "CELCASH", transacaoId: fonte.id, tipo: "RECEBIMENTO", valorCentavos: 11800, data: new Date("2026-11-03T13:30:00Z"), bruto: { valorFicticio: 118 } };
const cobranca = { gatewayId: "cashbarber:pag:legado", valorRecebidoConfirmadoCentavos: null, recebidoConfirmadoEm: null, provaRecebimento: null, recebimentoPendente: null };

describe("prova de recebimento na correção histórica", () => {
  it("usa valor do crédito único e a data efetiva da transação, conservando a origem legada", () => {
    const r = prepararRecebimentoHistorico(fonte, movimento, cobranca, false);
    const atual = { ...cobranca, ...r.dados };
    expect(r.comprovado).toBe(true); expect(provaRecebimentoValida(atual)).toBe(true);
    expect(atual.recebidoConfirmadoEm?.toISOString()).toBe(fonte.pagamentoEfetivoEm);
    expect(atual.provaRecebimento).toMatchObject({ fonte: "conciliacao", fonteGateway: "celcash", referencia: cobranca.gatewayId, campoData: "Transactions.paydayDateDateTime", movimentosExternos: [{ id: movimento.id, idExterno: movimento.idExterno }] });
    expect(r.evidenciaSha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it("não importa uma cobrança paga sem a data efetiva; vínculo permanece explicitamente pendente", () => {
    const semData = { ...fonte, pagamentoEfetivoEm: null };
    expect(() => prepararRecebimentoHistorico(semData, movimento, cobranca, true)).toThrow(/data efetiva/);
    const r = prepararRecebimentoHistorico(semData, movimento, cobranca, false);
    expect(r.comprovado).toBe(false); expect(r.dados).toEqual({ recebimentoPendente: expect.stringContaining("data do crédito") });
    expect(r.dados).not.toHaveProperty("provaRecebimento");
  });
  it.each([{ pagoForaDoGateway: true }, { pagamentoEfetivoEm: "2026-11-04T13:30:00Z" }])("não cria prova para origem/data não comprovadas: %j", alteracao => {
    expect(() => prepararRecebimentoHistorico({ ...fonte, ...alteracao }, movimento, cobranca, true)).toThrow();
  });
  it("preserva prova válida concordante e recusa substituir data ou valor contraditórios", () => {
    const primeira = prepararRecebimentoHistorico(fonte, movimento, cobranca, true);
    const atual = { ...cobranca, ...primeira.dados };
    const antes = structuredClone(atual);
    expect(prepararRecebimentoHistorico(fonte, movimento, atual, false).dados).toEqual({ recebimentoPendente: null });
    expect(() => prepararRecebimentoHistorico({ ...fonte, pagamentoEfetivoEm: "2026-11-01T13:30:00Z" }, movimento, atual, false)).toThrow(/preservada/);
    const outroValor = { ...atual, valorRecebidoConfirmadoCentavos: 10000, provaRecebimento: { ...atual.provaRecebimento!, valorCentavos: 10000 } };
    expect(() => prepararRecebimentoHistorico(fonte, movimento, outroValor, false)).toThrow(/preservada/);
    expect(atual).toEqual(antes);
  });
  it("recusa provas parciais e movimentos de outra transação", () => {
    expect(() => prepararRecebimentoHistorico(fonte, movimento, { ...cobranca, valorRecebidoConfirmadoCentavos: 1 }, false)).toThrow(/incompleta/);
    expect(() => prepararRecebimentoHistorico(fonte, { ...movimento, transacaoId: "outro" }, cobranca, true)).toThrow(/extrato/);
  });
  it("preserva prova completa anterior quando a leitura atual omite a data", () => {
    const atual = { ...cobranca, ...prepararRecebimentoHistorico(fonte, movimento, cobranca, true).dados };
    const r = prepararRecebimentoHistorico({ ...fonte, pagamentoEfetivoEm: null }, movimento, atual, false);
    expect(r.comprovado).toBe(true); expect(r.pendencia).toBeNull(); expect(r.dados).toEqual({});
    const pendente = prepararRecebimentoHistorico({ ...fonte, pagamentoEfetivoEm: null }, movimento, { ...atual, recebimentoPendente: "Conferência anterior ainda aberta" }, false);
    expect(pendente.comprovado).toBe(false); expect(pendente.pendencia).toBe("Conferência anterior ainda aberta");
  });
  it.each(["pagarme", "asaas", "simulado"])("não funde prova %s com crédito Celcash de valor e hora iguais", origem => {
    const atual = { ...cobranca, ...prepararRecebimentoHistorico(fonte, movimento, cobranca, true).dados };
    const outroGateway = { ...atual, provaRecebimento: { ...atual.provaRecebimento!, fonte: origem, fonteGateway: origem } };
    expect(() => prepararRecebimentoHistorico(fonte, movimento, outroGateway, false)).toThrow(/origem/);
  });
  it("recusa referências a outro crédito e preserva prova nativa da mesma transação Celcash", () => {
    const atual = { ...cobranca, ...prepararRecebimentoHistorico(fonte, movimento, cobranca, true).dados };
    expect(() => prepararRecebimentoHistorico(fonte, movimento, { ...atual, provaRecebimento: { ...atual.provaRecebimento!, movimentosExternos: [{ id: "outro" }] } }, false)).toThrow(/origem/);
    const gatewayId = `celtx_${fonte.id}`;
    const nativa = { ...atual, gatewayId, provaRecebimento: { versao: 1, fonte: "celcash", referencia: gatewayId, status: "captured", campoValor: "Transactions.value", campoData: "Transactions.paydayDateDateTime", em: fonte.pagamentoEfetivoEm, valorCentavos: 11800 } };
    expect(prepararRecebimentoHistorico({ ...fonte, pagamentoEfetivoEm: null }, movimento, nativa, false).dados).toEqual({});
  });
  it("alteração do extrato altera o hash sem copiar o conteúdo bruto na prova", () => {
    const a = prepararRecebimentoHistorico(fonte, movimento, cobranca, true);
    const b = prepararRecebimentoHistorico(fonte, { ...movimento, bruto: { valorFicticio: 119 } }, cobranca, true);
    expect(a.evidenciaSha256).not.toBe(b.evidenciaSha256);
    expect(JSON.stringify(a.dados)).not.toContain("valorFicticio");
  });
});
