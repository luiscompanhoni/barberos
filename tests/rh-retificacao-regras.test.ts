import { describe, expect, it } from "vitest";
import { DECLARACAO_TESTE_FOLHA, impedimentosTeste, loteImpedeRetificacao, zRetificacaoTeste } from "@/lib/rh/retificacao-regras";
import { situacaoDespesa, totaisDespesas } from "@/lib/financeiro/regras";
import { planejarLotePix } from "@/lib/rh/lote-pix-regras";
const em = new Date("2026-11-03T21:49:00Z");
const folha = { ativa: true, versao: 1, status: "PAGA", salarioCentavos: 100, comissaoCentavos: 0, adicionaisCentavos: 0, descontosCentavos: 0, liquidoCentavos: 100, despesaId: "despesa-ficticia", pagoEm: em };
const despesa = { id: "despesa-ficticia", status: "PAGA", categoria: "FOLHA", valorCentavos: 100, formaPagamento: "PIX", movimentoCaixaId: null, recorrente: false, pagoEm: em };
const lote = { estado: "PREPARADO", enviadoEm: null, referenciaBancaria: null, snapshot: { envioHabilitado: false, itens: [{ folhaId: "folha-ficticia" }] } };
describe("limites da retificação interna do teste", () => {
  it("aceita somente o retrato original interno de um real comprovado e sem banco", () => {
    expect(impedimentosTeste(folha, despesa, true, 0, [])).toEqual([]);
    for (const alterada of [{ ...folha, ativa: false }, { ...folha, versao: 2 }, { ...folha, status: "FECHADA" }, { ...folha, liquidoCentavos: 200 }, { ...folha, comissaoCentavos: 1 }]) expect(impedimentosTeste(alterada, despesa, true, 0, []).length).toBeGreaterThan(0);
    expect(impedimentosTeste(folha, despesa, false, 0, []).join(" ")).toContain("auditoria");
    expect(impedimentosTeste(folha, despesa, true, 1, []).join(" ")).toContain("bancária");
  });
  it("não usa declaração humana para anular caixa, recorrência, outro valor ou despesa ausente", () => {
    for (const d of [null, { ...despesa, movimentoCaixaId: "movimento-real" }, { ...despesa, recorrente: true }, { ...despesa, formaPagamento: "DINHEIRO_CAIXA" }, { ...despesa, valorCentavos: 101 }]) expect(impedimentosTeste(folha, d, true, 0, []).length).toBeGreaterThan(0);
  });
  it("lotes locais podem ser invalidados; enviado, pago, incerto ou estrutura desconhecida bloqueiam", () => {
    expect(loteImpedeRetificacao(lote)).toBe(false);
    for (const estado of ["ENVIADO", "PAGO", "INCERTO", "DESCONHECIDO"]) expect(loteImpedeRetificacao({ ...lote, estado })).toBe(true);
    expect(loteImpedeRetificacao({ ...lote, enviadoEm: em })).toBe(true);
    expect(loteImpedeRetificacao({ ...lote, referenciaBancaria: "" })).toBe(true);
    expect(loteImpedeRetificacao({ ...lote, snapshot: {} })).toBe(true);
    expect(loteImpedeRetificacao({ ...lote, snapshot: { envioHabilitado: false, itens: [{ status: "PAGO" }] } })).toBe(true);
    expect(loteImpedeRetificacao({ ...lote, snapshot: { envioHabilitado: false, itens: [{ endToEndId: "evidencia-ficticia" }] } })).toBe(true);
  });
  it("exige declaração literal, valor confirmado, motivo, revisão e chave por tentativa", () => {
    const d = { folhaId: "ficticia", idempotencia: "173d07ec-335b-4d11-9af6-680cb8afc86d", revisao: "a".repeat(64), motivo: "Teste interno sem transferência, confirmado pelo dono.", salarioSubstitutivoCentavos: 600000, valorOriginalConfirmadoCentavos: 100, declaracao: DECLARACAO_TESTE_FOLHA };
    expect(zRetificacaoTeste.parse(d)).toEqual(d);
    for (const invalida of [{ ...d, declaracao: "sim" }, { ...d, valorOriginalConfirmadoCentavos: 1 }, { ...d, salarioSubstitutivoCentavos: -1 }, { ...d, motivo: "teste" }, { ...d, enviarPix: true }, { ...d, idempotencia: undefined }]) expect(zRetificacaoTeste.safeParse(invalida).success).toBe(false);
  });
  it("despesa anulada permanece identificável e não volta a pagar ou compor os totais", () => {
    expect(situacaoDespesa({ status: "ANULADA_TESTE", vencimento: "2026-11-03" }, "2026-11-08")).toBe("ANULADA_TESTE");
    const t = totaisDespesas([{ categoria: "FOLHA", status: "ANULADA_TESTE", valorCentavos: 100, vencimento: "2026-11-03", pagoEm: "2026-11-03" }], "2026-11-08", "2026-11");
    expect(t.aPagar).toBe(0); expect(t.pagasNoMes).toBe(0); expect(t.porCategoria.FOLHA.pago).toBe(0);
  });
  it("versão da folha participa do hash Pix e versão inativa nunca vira item a pagar", () => {
    const f = { id: "ficticia", pessoaId: "pessoa", ativa: true, versao: 1, status: "FECHADA", criadoEm: em, salarioCentavos: 100, comissaoCentavos: 0, adicionaisCentavos: 0, descontosCentavos: 0, liquidoCentavos: 100, pessoa: { nome: "Fixture", ativo: true, revisaoPix: 0, chavePix: null } };
    const original = planejarLotePix("2026-11", [f]);
    expect(planejarLotePix("2026-11", [{ ...f, versao: 2 }]).revisao).not.toBe(original.revisao);
    expect(planejarLotePix("2026-11", [{ ...f, ativa: false }]).itens).toEqual([]);
  });
});
