import { beforeEach, describe, expect, it, vi } from "vitest";

const { premio, enviar, janela, cloud } = vi.hoisted(() => ({
  premio: vi.fn(), enviar: vi.fn(), janela: vi.fn(), cloud: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { premioGanho: { findFirst: premio } } }));
vi.mock("@/lib/dominios", () => ({ urlSite: () => "http://localhost:3000" }));
vi.mock("@/lib/whatsapp/canal", () => ({ dentroJanela24h: janela, temJanela24h: cloud }));
vi.mock("@/lib/whatsapp/conversas", () => ({ enviarNaConversa: enviar }));

import { responderNudgeRoleta } from "@/lib/bot/resposta-roleta";

const conversa = { id: "conversa", clienteId: "cliente", ultimaEntradaEm: new Date() };
const ativo = async () => true;

describe("resposta ao nudge da roleta", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    premio.mockResolvedValue({ id: "premio" });
    enviar.mockResolvedValue({ ok: true });
  });

  it("oferece a agenda com o prêmio da própria jogada e voz da recepção", async () => {
    expect(await responderNudgeRoleta(conversa, "jogada", "Pode mandar!", ativo)).toBe(true);
    expect(premio).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ clienteId: "cliente", jogadaId: "jogada" }) }));
    const [, texto, autor] = enviar.mock.calls[0];
    expect(autor).toBe("BOT");
    expect(texto).toContain("http://localhost:3000/c/agendar?premio=premio");
    expect(texto).not.toMatch(/\bvocê\b/i);
  });

  it("respeita recusa e encaminha dúvida sem sair com link", async () => {
    expect(await responderNudgeRoleta(conversa, "jogada", "É sobre qual prêmio?", ativo)).toBe(false);
    expect(await responderNudgeRoleta(conversa, "jogada", "Agora não", ativo)).toBe(true);
    expect(premio).not.toHaveBeenCalled();
    expect(enviar.mock.calls[0][1]).not.toContain("http");
  });

  it("aguarda a equipe quando o turno muda ou a janela oficial fecha", async () => {
    expect(await responderNudgeRoleta(conversa, "jogada", "Sim", async () => false)).toBe(false);
    cloud.mockReturnValue(true);
    janela.mockReturnValue(false);
    expect(await responderNudgeRoleta(conversa, "jogada", "Sim", ativo)).toBe(false);
    expect(enviar).not.toHaveBeenCalled();
  });
});
