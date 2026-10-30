import { describe, expect, it } from "vitest";
import { chaveAgenda, chaveRecompra, dadosAgenda, dadosAvaliacao, dadosEquipe, dadosRecompra, limiteGeracao, mesmosCiclos } from "@/lib/notificacoes/geracao-regras";

describe("identidade dos eventos de notificação", () => {
  it("remarcar ou mudar fase cria outra chave; repetir o evento preserva a identidade", () => {
    const inicio = new Date("2027-07-12T13:00:00Z");
    expect(chaveAgenda("a", inicio, "LEMBRETE_VESPERA")).toBe(chaveAgenda("a", new Date(inicio), "LEMBRETE_VESPERA"));
    expect(chaveAgenda("a", inicio, "LEMBRETE_VESPERA")).not.toBe(chaveAgenda("a", inicio, "LEMBRETE_PROXIMO"));
    expect(chaveAgenda("a", inicio, "LEMBRETE_PROXIMO")).not.toBe(chaveAgenda("a", new Date(+inicio + 60_000), "LEMBRETE_PROXIMO"));
  });
  it("agrupa serviços em chave curta, estável e sem IDs/nomes expostos", () => {
    const ciclos = [{ servicoId: "hidratação", ultimaEm: "2027-07-01T12:00:00.000Z" }, { servicoId: "barba", ultimaEm: "2027-07-02T12:00:00.000Z" }];
    const chave = chaveRecompra(ciclos, 10);
    expect(chave).toBe(chaveRecompra([...ciclos].reverse(), 10));
    expect(chave).toBe(chaveRecompra([...ciclos, ciclos[0]], 10));
    expect(chave).not.toContain("hidratação");
    expect(chave.length).toBeLessThan(100);
    expect(chave).not.toBe(chaveRecompra(ciclos, 11));
  });
  it("um novo ciclo da compra não recebe a chave do anterior", () => {
    expect(chaveRecompra([{ servicoId: "a", ultimaEm: "ontem" }], 10)).not.toBe(chaveRecompra([{ servicoId: "a", ultimaEm: "hoje" }], 10));
  });
});

describe("relevância dos ciclos", () => {
  const a = { servicoId: "a", ultimaEm: "2027-07-01T12:00:00.000Z" };
  const b = { servicoId: "b", ultimaEm: "2027-07-01T12:00:00.000Z" };
  it("mantém o aviso enquanto todos seus serviços continuam devidos", () => {
    expect(mesmosCiclos([a], [b, a])).toBe(true);
    expect(mesmosCiclos([a, b], [b, a])).toBe(true);
  });
  it("recusa, novo agendamento ou recompra invalidam o aviso antigo", () => {
    expect(mesmosCiclos([a, b], [a])).toBe(false);
    expect(mesmosCiclos([a], [{ ...a, ultimaEm: "2027-07-10T12:00:00.000Z" }])).toBe(false);
    expect(mesmosCiclos([], [])).toBe(false);
  });
});

describe("metadados e limite do lote", () => {
  it("rejeita metadados insuficientes ou datas de evento malformadas", () => {
    expect(dadosAgenda.safeParse({ agendamentoId: "a", inicio: "hoje", tipo: "LEMBRETE_PROXIMO" }).success).toBe(false);
    expect(dadosAvaliacao.safeParse({ conviteId: "" }).success).toBe(false);
    expect(dadosRecompra.safeParse({ clienteId: "c", ciclos: [] }).success).toBe(false);
    expect(dadosEquipe.safeParse({ barbeiroId: "b", data: "amanhã" }).success).toBe(false);
  });
  it("mantém lotes finitos e com pelo menos um usuário", () => {
    expect(limiteGeracao(undefined)).toBe(50);
    expect(limiteGeracao(Infinity)).toBe(50);
    expect(limiteGeracao(-10)).toBe(1);
    expect(limiteGeracao(400)).toBe(200);
    expect(limiteGeracao(12.8)).toBe(12);
  });
});
