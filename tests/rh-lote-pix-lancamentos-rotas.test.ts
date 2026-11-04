import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ sessao: vi.fn(), lancar: vi.fn() }));
vi.mock("@/lib/auth/permissoes", () => ({ exigirSessaoCom: m.sessao }));
vi.mock("@/lib/rh/folha", () => ({ lancar: m.lancar, excluirLancamento: vi.fn() }));
import { POST } from "@/app/api/rh/folha/lancamentos/route";
const origin = "https://painel.example";
const d = { competencia: "2039-11", pessoaId: "pessoa1", tipo: "VALE", valorCentavos: 10000, descricao: "Vale sintético", doCaixa: true, idempotencia: "173d07ec-335b-4d11-9af6-680cb8afc86d" };
const req = (body: unknown, origem = origin) => new Request(origin + "/api/rh/folha/lancamentos", { method: "POST", headers: { origin: origem, "content-type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("PAINEL_URL", origin); m.sessao.mockResolvedValue({ usuarioId: "dono", papel: "DONO" }); m.lancar.mockResolvedValue({ id: d.idempotencia }); });
afterEach(() => vi.unstubAllEnvs());
describe("lançamento manual: chave obrigatória na API", () => {
  it("rejeita chave ausente ou inválida antes de executar", async () => {
    const semChave = { ...d, idempotencia: undefined };
    const r = await POST(req(semChave)); expect(r.status).toBe(400); expect((await r.json()).erro).toContain("Atualize a página da folha");
    expect((await POST(req({ ...d, idempotencia: "invalida" }))).status).toBe(400); expect(m.lancar).not.toHaveBeenCalled();
  });
  it("preserva ID de resposta e passa chave validada com ator da sessão", async () => {
    const r = await POST(req(d)); expect(r.status).toBe(200); expect(await r.json()).toEqual({ id: d.idempotencia }); expect(m.lancar).toHaveBeenCalledWith({ usuarioId: "dono", papel: "DONO" }, d);
  });
  it("rejeita origem externa e corpo grande sem criar lançamento", async () => {
    expect((await POST(req(d, "https://outro.painel.example"))).status).toBe(403); expect((await POST(req({ ...d, extra: "x".repeat(33000) }))).status).toBe(413); expect(m.lancar).not.toHaveBeenCalled();
  });
});
