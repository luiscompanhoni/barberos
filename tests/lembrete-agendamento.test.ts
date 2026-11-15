import { describe, expect, it } from "vitest";
import { ATRASO_LEMBRETE_MS, VALIDADE_LEMBRETE_MS, lembreteAgendamentoDevido } from "@/lib/agenda/abandono-regras";

describe("prévia do lembrete de agendamento", () => {
  const agora = Date.parse("2026-11-15T15:00:00Z");
  const r = (ultimaAcaoEm: number) => ({
    consentiuEm: new Date(ultimaAcaoEm - 60_000), ultimaAcaoEm: new Date(ultimaAcaoEm), canceladoEm: null,
  });

  it("fica elegível só depois de duas horas da última ação", () => {
    expect(lembreteAgendamentoDevido(r(agora - ATRASO_LEMBRETE_MS + 1), agora)).toBe(false);
    expect(lembreteAgendamentoDevido(r(agora - ATRASO_LEMBRETE_MS), agora)).toBe(true);
  });

  it("não retoma consentimento cancelado ou antigo", () => {
    expect(lembreteAgendamentoDevido({ ...r(agora - ATRASO_LEMBRETE_MS), canceladoEm: new Date(agora) }, agora)).toBe(false);
    expect(lembreteAgendamentoDevido(r(agora - VALIDADE_LEMBRETE_MS - 1), agora)).toBe(false);
    expect(lembreteAgendamentoDevido({ ...r(agora - ATRASO_LEMBRETE_MS), consentiuEm: new Date(agora) }, agora)).toBe(false);
  });
});
