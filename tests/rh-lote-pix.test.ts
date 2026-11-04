import { describe, expect, it } from "vitest";
import { analisarChavePix, planejarLotePix, type FolhaParaPix } from "@/lib/rh/lote-pix-regras";

const folha = (id = "a", extras: Partial<FolhaParaPix> = {}): FolhaParaPix => ({
  id, pessoaId: `pessoa-${id}`, criadoEm: new Date("2026-11-01T12:00:00Z"), status: "FECHADA",
  salarioCentavos: 10000, comissaoCentavos: 1000, adicionaisCentavos: 0, descontosCentavos: 500, liquidoCentavos: 10500,
  pessoa: { nome: `Pessoa ${id}`, chavePix: `${id}@example.com`, ativo: true, revisaoPix: 0 }, ...extras,
});
describe("preparação da folha Pix", () => {
  it.each([
    ["529.982.247-25", "CPF"], ["11.222.333/0001-81", "CNPJ"], ["pessoa@example.com", "EMAIL"],
    ["+5541999999999", "TELEFONE"], ["123e4567-e89b-42d3-a456-426614174000", "ALEATORIA"],
  ])("valida somente o formato %s (%s)", (chave, tipo) => {
    const r = analisarChavePix(chave);
    expect(r.tipo).toBe(tipo); expect(r.problema).toBeNull(); expect(r.mascarada).not.toBe(chave);
  });
  it.each([null, "11111111111", "11222333000182", "pessoa@", "41999999999", "não-é-uma-chave"]) ("aponta chave ausente/inválida %s", chave => {
    expect(analisarChavePix(chave).problema).toBeTruthy();
  });
  it("soma apenas folhas fechadas positivas, sem registrar pagamento ou verificar banco", () => {
    const p = planejarLotePix("2026-11", [folha(), folha("b", { status: "PAGA" }), folha("c", { liquidoCentavos: 0 }), folha("d", { liquidoCentavos: -500 }), folha("e", { status: "ABERTA" })]);
    expect(p.totalCentavos).toBe(10500); expect(p.itens).toHaveLength(1); expect(p.excluidas).toBe(4);
    expect(p.envioHabilitado).toBe(false); expect(p.itens[0].destinatario).toBe("NAO_VERIFICADO");
    expect(JSON.stringify(p)).not.toContain("a@example.com");
  });
  it("mesma revisão é independente da ordem da consulta", () => {
    expect(planejarLotePix("2026-11", [folha(), folha("b")]).revisao).toBe(planejarLotePix("2026-11", [folha("b"), folha()]).revisao);
  });
  it("duplicatas normalizadas bloqueiam a conferência, sem esconder o total", () => {
    const a = folha(), b = folha("b"); b.pessoa.chavePix = "A@example.com";
    const p = planejarLotePix("2026-11", [a, b]);
    expect(p.podeConferir).toBe(false); expect(p.totalCentavos).toBe(21000);
    expect(p.itens.every(i => i.problemas.some(x => x.includes("compartilhada")))).toBe(true);
  });
  it("troca de chave, revisão cadastral, status, valor e fechamento invalidam a revisão", () => {
    const original = planejarLotePix("2026-11", [folha()]).revisao;
    for (const alterada of [folha("a", { status: "PAGA" }), folha("a", { liquidoCentavos: 10600 }), folha("a", { id: "novo-fechamento" }), folha("a", { pessoa: { ...folha().pessoa, chavePix: "outra@example.com" } }), folha("a", { pessoa: { ...folha().pessoa, revisaoPix: 2 } })]) {
      expect(planejarLotePix("2026-11", [alterada]).revisao).not.toBe(original);
    }
  });
  it("cadastro inválido impede conferência e lote vazio não é conferível", () => {
    expect(planejarLotePix("2026-11", [folha("a", { pessoa: { ...folha().pessoa, chavePix: null } })]).podeConferir).toBe(false);
    expect(planejarLotePix("2026-11", []).podeConferir).toBe(false);
  });
  it("recusa competência inválida e total fora do inteiro PostgreSQL", () => {
    expect(() => planejarLotePix("2026-13", [])).toThrow();
    expect(() => planejarLotePix("2026-11", [folha("a", { liquidoCentavos: 2_147_483_647 }), folha("b")])).toThrow("Valores inválidos");
  });
});
