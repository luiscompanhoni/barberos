import { describe, expect, it } from "vitest";
import { canonicoConferencia, hashConferencia } from "@/lib/conciliacao/despesas-conferencia";
import { exigirDonoConciliacao, parDespesaValido } from "@/lib/conciliacao/despesas-vinculos";
import type { Sessao } from "@/lib/auth/sessao";

describe("conciliação: evidência, identidade e preservação", () => {
  const movimento = { fonte: "STONE", tipo: "PAGAMENTO", valorCentavos: -12500 };
  const despesa = { status: "PAGA", valorCentavos: 12500, pagoEm: new Date("2026-10-10T15:00Z"), formaPagamento: "PIX" };
  it("aceita somente pagamento bancário negativo e despesa paga do mesmo valor", () => {
    expect(parDespesaValido(movimento, despesa)).toBe(true);
    for (const m of [{ ...movimento, fonte: "CASHBARBER" }, { ...movimento, tipo: "TRANSFERENCIA" }, { ...movimento, valorCentavos: 12500 }, { ...movimento, valorCentavos: 0 }]) expect(parDespesaValido(m, despesa)).toBe(false);
    for (const d of [{ ...despesa, status: "PENDENTE" }, { ...despesa, valorCentavos: 12499 }, { ...despesa, pagoEm: null }, { ...despesa, formaPagamento: "DINHEIRO_CAIXA" }]) expect(parDespesaValido(movimento, d)).toBe(false);
  });
  it("não concede confirmação humana a gerente, recepção ou barbeiro", () => {
    for (const papel of ["GERENTE", "RECEPCAO", "BARBEIRO", "LIDER", "CLIENTE"] as const) expect(() => exigirDonoConciliacao({ papel } as Sessao)).toThrow();
    expect(() => exigirDonoConciliacao({ papel: "DONO" } as Sessao)).not.toThrow();
  });
  it("hash e snapshot não dependem da ordem das chaves nem de datas já serializadas", () => {
    const a = { observacao: "Ação", id: "ref", em: new Date("2026-10-10T15:00Z"), dados: { z: 2, a: 1 } };
    const b = { dados: { a: 1, z: 2 }, em: "2026-10-10T15:00:00.000Z", id: "ref", observacao: "Ação" };
    expect(JSON.parse(canonicoConferencia(a))).toEqual(b);
    expect(hashConferencia(a)).toBe(hashConferencia(b));
  });
  it("alterações de valor, status, prova, referência e pendência invalidam a mesma conferência", () => {
    const base = { valor: 12500, status: "PAGA", provaHash: "p1", referenciaId: "r1", pendentes: ["x"] };
    const hash = hashConferencia(base);
    for (const mudar of [{ valor: 12501 }, { status: "PENDENTE" }, { provaHash: "p2" }, { referenciaId: "r2" }, { pendentes: [] }]) expect(hashConferencia({ ...base, ...mudar })).not.toBe(hash);
  });
});
