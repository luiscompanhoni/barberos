import { describe, expect, it } from "vitest";
import { confirmouExclusao, impedimentosExclusao, telefoneExcluido } from "@/lib/lgpd/regras";

const nada = { assinaturasAbertas: 0, cobrancasEmAberto: 0, pagamentosPendentes: 0, comandasAbertas: 0, horariosFuturos: 0 };

describe("LGPD: exclusão da conta pelo cliente", () => {
  it("sem pendência pode excluir", () => expect(impedimentosExclusao(nada)).toEqual([]));
  it("plano, pagamento em aberto, comanda aberta e horário marcado impedem, com a frase do que fazer", () => {
    expect(impedimentosExclusao({ ...nada, assinaturasAbertas: 1 })[0]).toMatch(/plano/);
    expect(impedimentosExclusao({ ...nada, pagamentosPendentes: 1 })[0]).toMatch(/pagamento em aberto/);
    expect(impedimentosExclusao({ ...nada, cobrancasEmAberto: 2 })[0]).toMatch(/pagamento em aberto/);
    expect(impedimentosExclusao({ ...nada, comandasAbertas: 1 })[0]).toMatch(/comanda/);
    expect(impedimentosExclusao({ ...nada, horariosFuturos: 1 })[0]).toMatch(/horários/);
    expect(impedimentosExclusao({ assinaturasAbertas: 1, cobrancasEmAberto: 1, pagamentosPendentes: 1, comandasAbertas: 1, horariosFuturos: 1 })).toHaveLength(4);
  });
  it("confirmação aceita EXCLUIR sem diferenciar maiúsculas, acento ou espaços", () => {
    for (const t of ["EXCLUIR", "excluir", " Excluír "]) expect(confirmouExclusao(t)).toBe(true);
    for (const t of ["", "sim", "EXCLUI"]) expect(confirmouExclusao(t)).toBe(false);
  });
  it("telefone apagado não parece número e é único por cliente", () => {
    expect(telefoneExcluido("abc")).toBe("excluido-abc");
    expect(telefoneExcluido("abc")).not.toMatch(/^\d+$/);
  });
});
