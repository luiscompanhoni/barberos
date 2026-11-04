import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ agentes: vi.fn(), pagamentos: vi.fn(), automacoes: vi.fn() }));
vi.mock("@/lib/agentes/rotina-servidor", () => ({ agendarCentralAgentes: m.agentes }));
vi.mock("@/lib/assinaturas/rotina", () => ({ agendarRotina: m.pagamentos }));
vi.mock("@/lib/automacoes/rotina", () => ({ agendarAutomacoes: m.automacoes }));
import { register } from "@/instrumentation";
import { quarentenaRestauracao } from "@/lib/recuperacao/quarentena";

beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("NEXT_RUNTIME", "nodejs"); });
afterEach(() => vi.unstubAllEnvs());

describe("quarentena de restauração fora do banco", () => {
  it("não agenda nenhuma rotina quando a quarentena está ativa", async () => {
    vi.stubEnv("BARBEROS_QUARENTENA_RESTAURACAO", "true");
    await register();
    expect(m.agentes).not.toHaveBeenCalled(); expect(m.pagamentos).not.toHaveBeenCalled(); expect(m.automacoes).not.toHaveBeenCalled();
  });
  it("preserva a inicialização normal quando a flag está ausente", async () => {
    vi.stubEnv("BARBEROS_QUARENTENA_RESTAURACAO", "");
    await register();
    expect(m.agentes).toHaveBeenCalledOnce(); expect(m.pagamentos).toHaveBeenCalledOnce(); expect(m.automacoes).toHaveBeenCalledOnce();
  });
  it("mantém proteção com valor desconhecido e aceita false para desligar", () => {
    vi.stubEnv("BARBEROS_QUARENTENA_RESTAURACAO", "erro-de-digitacao"); expect(quarentenaRestauracao()).toBe(true);
    vi.stubEnv("BARBEROS_QUARENTENA_RESTAURACAO", "false"); expect(quarentenaRestauracao()).toBe(false);
  });
});
