import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ gerar: vi.fn(), enviar: vi.fn(), abandonos: vi.fn(), quarentena: vi.fn(() => false) }));
vi.mock("@/lib/notificacoes/geracao", () => ({ gerarNotificacoes: m.gerar }));
vi.mock("@/lib/notificacoes/envio", () => ({ processarPush: m.enviar }));
vi.mock("@/lib/jogos/jornada-roleta-rotina", () => ({ registrarAbandonosRoleta: m.abandonos }));
vi.mock("@/lib/recuperacao/quarentena", () => ({ quarentenaRestauracao: m.quarentena }));
import { rodarAutomacoes } from "@/lib/automacoes/rotina";
beforeEach(() => { vi.clearAllMocks(); m.quarentena.mockReturnValue(false); m.abandonos.mockResolvedValue(0); vi.stubEnv("WHATSAPP_ENVIOS_BLOQUEADOS", "true"); vi.stubEnv("WHATSAPP_LOTE_CAMPANHA_AUTORIZADO", ""); });
afterEach(() => vi.unstubAllEnvs());
it("gera e entrega avisos do aplicativo mesmo com os envios de WhatsApp bloqueados", async () => {
  const agora = new Date("2026-11-26T12:00:00Z");
  await rodarAutomacoes(+agora);
  expect(m.gerar).toHaveBeenCalledWith(agora, {});
  expect(m.enviar).toHaveBeenCalledWith(agora, {});
});
it("quarentena de restauração continua bloqueando também o aplicativo", async () => {
  m.quarentena.mockReturnValue(true);
  await rodarAutomacoes();
  expect(m.gerar).not.toHaveBeenCalled(); expect(m.enviar).not.toHaveBeenCalled();
});
