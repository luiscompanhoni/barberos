import { describe, expect, it } from "vitest";
import { planejarLotes } from "@/lib/avaliacoes/lotes";

const resposta = (id: number, mes: string, publicada = false) => ({
  id: String(id).padStart(3, "0"), nota: id % 5 + 1, criadaEm: new Date(`${mes}-20T12:00:00Z`), publicada,
});

describe("publicação prospectiva de avaliações por lote", () => {
  it("duas respostas em outubro e três em novembro liberam cinco na competência da quinta", () => {
    const r = planejarLotes([resposta(1, "2026-10"), resposta(2, "2026-10"), ...[3, 4, 5].map(i => resposta(i, "2026-11"))], {});
    expect(r?.periodos).toEqual({ "2026-11": { quantidade: 5, soma: 15 } });
    expect(r?.publicadas).toHaveLength(5);
  });
  it("de uma a quatro respostas não alteram nem republicam o histórico", () => {
    expect(planejarLotes([resposta(1, "2026-10"), resposta(2, "2026-11")], {})).toBeNull();
  });
  it("cada lote usa a competência de sua própria quinta resposta, com ordem estável", () => {
    const entradas = Array.from({ length: 10 }, (_, i) => resposta(i + 1, i < 5 ? "2026-10" : "2026-11")).reverse();
    const r = planejarLotes(entradas, {});
    expect(r?.periodos).toEqual({ "2026-10": { quantidade: 5, soma: 15 }, "2026-11": { quantidade: 5, soma: 15 } });
    expect(r?.ids).toEqual(Array.from({ length: 10 }, (_, i) => String(i + 1).padStart(3, "0")));
  });
  it("não redistribui legado já publicado nem modifica o objeto dos períodos anteriores", () => {
    const anterior = { "2026-09": { quantidade: 5, soma: 20 } };
    const legado = Array.from({ length: 5 }, (_, i) => resposta(i + 1, i < 2 ? "2026-09" : "2026-10", true));
    const novas = Array.from({ length: 5 }, (_, i) => resposta(i + 6, "2026-11"));
    const r = planejarLotes([...legado, ...novas], anterior);
    expect(r?.periodos).toEqual({ "2026-09": { quantidade: 5, soma: 20 }, "2026-11": { quantidade: 5, soma: 15 } });
    expect(anterior).toEqual({ "2026-09": { quantidade: 5, soma: 20 } });
    expect(r?.ids).toEqual(novas.map(n => n.id));
    expect(r?.publicadas).toHaveLength(10);
  });
  it("legado misto sem período continua sem atribuição retroativa; repetir não duplica pontos", () => {
    const legado = Array.from({ length: 5 }, (_, i) => resposta(i + 1, i < 2 ? "2026-09" : "2026-10", true));
    const novas = Array.from({ length: 5 }, (_, i) => resposta(i + 6, "2026-11"));
    const r = planejarLotes([...legado, ...novas], {})!;
    expect(r.periodos).toEqual({ "2026-11": { quantidade: 5, soma: 15 } });
    expect(planejarLotes(r.publicadas.map(n => ({ ...n, publicada: true })), r.periodos)).toBeNull();
  });
  it("o resto de um novo lote permanece privado mesmo após liberar outro", () => {
    const r = planejarLotes(Array.from({ length: 9 }, (_, i) => resposta(i + 1, "2026-11")), {});
    expect(r?.ids).toHaveLength(5);
    expect(r?.periodos["2026-11"].quantidade).toBe(5);
  });
  it.each([null, [], { "2026-13": { quantidade: 5, soma: 25 } }, { "2026-10": { quantidade: 4, soma: 20 } }, { "2026-10": { quantidade: 5, soma: 26 } }])("não sobrescreve um histórico inconsistente", historico => {
    expect(() => planejarLotes(Array.from({ length: 5 }, (_, i) => resposta(i + 1, "2026-11")), historico)).toThrow(/conferência/);
  });
});
