import { beforeEach, describe, expect, it, vi } from "vitest";
import { proibido } from "@/lib/erros";
const m = vi.hoisted(() => ({ papel: "DONO", vincular: vi.fn(), anular: vi.fn(), conferir: vi.fn(), distintos: vi.fn() }));
vi.mock("@/lib/auth/sessao", () => ({ exigirSessao: async (papeis: string[]) => { if (!papeis.includes(m.papel)) throw proibido(); return { usuarioId: "dono-ficticio", papel: m.papel }; } }));
vi.mock("@/lib/conciliacao/despesas-vinculos", () => ({ vincularDespesaExterna: m.vincular, anularVinculoDespesa: m.anular, confirmarDespesasDistintas: m.distintos }));
vi.mock("@/lib/conciliacao/despesas-conferencia", () => ({ conferirExtratoMes: m.conferir }));
import { POST } from "@/app/api/financeiro/conciliacao-despesas/route";
const chamar = (body: unknown) => POST(new Request("http://localhost/api/financeiro/conciliacao-despesas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
beforeEach(() => { vi.clearAllMocks(); m.papel = "DONO"; m.vincular.mockResolvedValue({ id: "vinculo-ficticio" }); m.anular.mockResolvedValue({ id: "vinculo-ficticio" }); m.conferir.mockResolvedValue({ id: "conferencia-ficticia" }); m.distintos.mockResolvedValue({ registrado: true }); });
describe("conciliação de despesas: API protegida", () => {
  it.each(["GERENTE", "RECEPCAO", "LIDER", "BARBEIRO", "CLIENTE"])("%s não vincula, anula ou declara cobertura", async papel => {
    m.papel = papel;
    for (const acao of ["VINCULAR", "ANULAR", "CONFERIR", "DISTINTOS"]) expect((await chamar({ acao })).status).toBe(403);
    expect(m.vincular).not.toHaveBeenCalled(); expect(m.anular).not.toHaveBeenCalled(); expect(m.conferir).not.toHaveBeenCalled(); expect(m.distintos).not.toHaveBeenCalled();
  });
  it("cobertura exige confirmação explícita do mês completo e hash válido", async () => {
    const b = { acao: "CONFERIR", mes: "2026-10", fonte: "STONE", hashDados: "a".repeat(64), motivo: "Extrato fictício conferido" };
    expect((await chamar(b)).status).toBe(400);
    expect((await chamar({ ...b, mesCompleto: false })).status).toBe(400);
    expect((await chamar({ ...b, mesCompleto: true, hashDados: "velho" })).status).toBe(400);
    expect(m.conferir).not.toHaveBeenCalled();
    expect((await chamar({ ...b, mesCompleto: true })).status).toBe(200);
    expect(m.conferir).toHaveBeenCalledWith(expect.objectContaining({ papel: "DONO" }), "2026-10", "STONE", "a".repeat(64), b.motivo);
  });
  it("anulação exige uma justificativa e encaminha somente IDs validados", async () => {
    expect((await chamar({ acao: "ANULAR", vinculoId: "v", motivo: "x" })).status).toBe(400);
    expect(m.anular).not.toHaveBeenCalled();
    expect((await chamar({ acao: "ANULAR", vinculoId: "v", motivo: "Comprovante divergente" })).status).toBe(200);
    expect(m.anular).toHaveBeenCalledWith(expect.objectContaining({ papel: "DONO" }), "v", "Comprovante divergente");
  });
  it("decisão por pagamentos distintos não chama vínculo ou pagamento", async () => {
    expect((await chamar({ acao: "DISTINTOS", movimentoId: "m", despesaId: "d", motivo: "Comprovantes diferentes" })).status).toBe(200);
    expect(m.distintos).toHaveBeenCalledWith(expect.objectContaining({ papel: "DONO" }), "m", "d", "Comprovantes diferentes");
    expect(m.vincular).not.toHaveBeenCalled(); expect(m.anular).not.toHaveBeenCalled(); expect(m.conferir).not.toHaveBeenCalled();
  });
});
