import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ avisos: vi.fn(), enviar: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { notificacao: { findMany: m.avisos } } }));
vi.mock("@/lib/notificacoes/envio", () => ({ processarPush: m.enviar }));
import { enviarAvisosNovoAgendamento } from "@/lib/notificacoes/envio-agendamento";
beforeEach(() => { vi.clearAllMocks(); });
it("a entrega imediata drena somente os avisos da reserva confirmada", async () => {
  m.avisos.mockResolvedValue([{ id: "aviso-profissional" }, { id: "aviso-dono" }]);
  await enviarAvisosNovoAgendamento("reserva");
  expect(m.avisos).toHaveBeenCalledWith({ where: { chave: "novo-agendamento:reserva", categoria: "EQUIPE" }, select: { id: true } });
  expect(m.enviar).toHaveBeenCalledWith(expect.any(Date), { notificacaoIds: ["aviso-profissional", "aviso-dono"], limite: 50 });
});
it("não drena a fila inteira quando a reserva não tem aviso", async () => {
  m.avisos.mockResolvedValue([]);
  await enviarAvisosNovoAgendamento("reserva");
  expect(m.enviar).not.toHaveBeenCalled();
});
it("falha de envio não desfaz a reserva e mantém a fila para a próxima rotina", async () => {
  m.avisos.mockResolvedValue([{ id: "aviso" }]); m.enviar.mockRejectedValueOnce(new Error("indisponível"));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(enviarAvisosNovoAgendamento("reserva")).resolves.toBeUndefined();
  expect(log).toHaveBeenCalledOnce(); log.mockRestore();
});
