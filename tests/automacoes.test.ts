import { describe, expect, it } from "vitest";
import { dobrarLinha, escaparIcs, gerarIcs } from "@/lib/automacoes/calendario";
import { horarioComercial, lembreteDevido, pediuParar, quandoFalar } from "@/lib/automacoes/regras";

const H = 3_600_000;
const FUSO = "America/Sao_Paulo";
// 2026-10-01 12:00 em Brasilia (15:00 UTC)
const agora = Date.UTC(2026, 9, 1, 15, 0);
const cfg = { lembreteHorasAntes: 24, lembreteMinutosAntes: 90 };

describe("lembretes", () => {
  it("vespera: dentro das 24h, marcado antes, ainda nao confirmado", () => {
    expect(lembreteDevido({ inicio: agora + 20 * H, criadoEm: agora - 3 * 24 * H, status: "MARCADO" }, agora, cfg)).toBe("LEMBRETE_VESPERA");
  });
  it("nao lembra na vespera quem ja confirmou ou acabou de marcar", () => {
    expect(lembreteDevido({ inicio: agora + 20 * H, criadoEm: agora - 3 * 24 * H, status: "CONFIRMADO" }, agora, cfg)).toBeNull();
    expect(lembreteDevido({ inicio: agora + 20 * H, criadoEm: agora - 1 * H, status: "MARCADO" }, agora, cfg)).toBeNull();
  });
  it("vespera fica longe do lembrete de ultima hora", () => {
    // faltam 2h: passou da janela da vespera (precisa faltar mais de 90 min + 1 h) e ainda nao e hora do proximo
    expect(lembreteDevido({ inicio: agora + 2 * H, criadoEm: agora - 48 * H, status: "MARCADO" }, agora, cfg)).toBeNull();
  });
  it("proximo: faltando ate 90 min (e pelo menos 15), inclusive confirmado", () => {
    expect(lembreteDevido({ inicio: agora + 60 * 60_000, criadoEm: agora - 48 * H, status: "CONFIRMADO" }, agora, cfg)).toBe("LEMBRETE_PROXIMO");
    expect(lembreteDevido({ inicio: agora + 10 * 60_000, criadoEm: agora - 48 * H, status: "MARCADO" }, agora, cfg)).toBeNull();
    expect(lembreteDevido({ inicio: agora + 60 * 60_000, criadoEm: agora - 10 * 60_000, status: "MARCADO" }, agora, cfg)).toBeNull();
  });
  it("desligados, cancelado ou ja passou", () => {
    expect(lembreteDevido({ inicio: agora + 20 * H, criadoEm: agora - 72 * H, status: "MARCADO" }, agora, { lembreteHorasAntes: 0, lembreteMinutosAntes: 0 })).toBeNull();
    expect(lembreteDevido({ inicio: agora + 60 * 60_000, criadoEm: agora - 72 * H, status: "CANCELADO" }, agora, cfg)).toBeNull();
    expect(lembreteDevido({ inicio: agora - H, criadoEm: agora - 72 * H, status: "MARCADO" }, agora, cfg)).toBeNull();
  });
});

describe("textos e horarios", () => {
  it("horario comercial 8h-21h de Brasilia", () => {
    expect(horarioComercial(agora, FUSO)).toBe(true);
    expect(horarioComercial(Date.UTC(2026, 9, 2, 1, 0), FUSO)).toBe(false); // 22h
    expect(horarioComercial(Date.UTC(2026, 9, 1, 10, 30), FUSO)).toBe(false); // 7h30
  });
  it("hoje / amanha / dia da semana", () => {
    expect(quandoFalar(agora + 3 * H, agora, FUSO)).toBe("hoje às 15:00");
    expect(quandoFalar(agora + 24 * H, agora, FUSO)).toBe("amanhã (sexta, 02/10) às 12:00");
    expect(quandoFalar(agora + 72 * H, agora, FUSO)).toBe("domingo, 04/10 às 12:00");
  });
  it("PARAR", () => {
    expect(pediuParar("PARAR")).toBe(true);
    expect(pediuParar("  pare! ")).toBe(true);
    expect(pediuParar("não quero mais receber mensagens")).toBe(true);
    expect(pediuParar("pode parar o corte na sexta?")).toBe(false);
  });
});

describe("calendario .ics", () => {
  it("escapa texto e dobra linha longa", () => {
    expect(escaparIcs("Corte, barba; ok\nobs")).toBe("Corte\\, barba\\; ok\\nobs");
    const longa = "DESCRIPTION:" + "á".repeat(80);
    const dobrada = dobrarLinha(longa);
    for (const l of dobrada.split("\r\n")) expect(Buffer.byteLength(l)).toBeLessThanOrEqual(75);
    expect(dobrada.split("\r\n").slice(1).every((l) => l.startsWith(" "))).toBe(true);
  });
  it("gera eventos em UTC com UID e status", () => {
    const ics = gerarIcs("Black Barber · Pedro", [
      { uid: "a1@barberos", inicio: new Date("2026-10-02T12:00:00Z"), fim: new Date("2026-10-02T12:30:00Z"), titulo: "Corte · Rafael (plano)", confirmado: false },
    ], new Date("2026-10-01T15:00:00Z"));
    expect(ics).toContain("BEGIN:VCALENDAR\r\n");
    expect(ics).toContain("DTSTART:20261002T120000Z");
    expect(ics).toContain("DTEND:20261002T123000Z");
    expect(ics).toContain("UID:a1@barberos");
    expect(ics).toContain("STATUS:TENTATIVE");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});
