import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Papel } from "@prisma/client";
import { ErroNegocio } from "@/lib/erros";

const m = vi.hoisted(() => ({ papel: "RECEPCAO" as Papel | null, barbeiroId: null as string | null, modo: "stone", exigir: vi.fn(), registrar: vi.fn(), cancelar: vi.fn(), conferir: vi.fn(), simular: vi.fn(), detalhe: vi.fn(), pagamento: vi.fn(), maquinas: vi.fn(), comanda: vi.fn() }));
vi.mock("@/lib/auth/sessao", () => ({ BALCAO: ["DONO", "GERENTE", "RECEPCAO"], exigirSessao: m.exigir }));
vi.mock("@/lib/comandas/maquininha", () => ({
  registrarPagamento: m.registrar, cancelarPagamento: m.cancelar, sincronizarPedido: m.conferir,
  simularAprovacao: m.simular, maquininhas: m.maquinas, modoMaquininha: () => m.modo,
}));
vi.mock("@/lib/comandas/servico", () => ({ detalheComanda: m.detalhe }));
vi.mock("@/lib/db", () => ({ db: { pagamentoComanda: { findUnique: m.pagamento }, comanda: { findFirst: m.comanda } } }));
import { POST } from "@/app/api/comandas/[id]/pagamentos/route";
import { PATCH } from "@/app/api/comandas/pagamentos/[id]/route";
import { GET } from "@/app/api/comandas/maquininhas/route";

const ctx = { params: Promise.resolve({ id: "pg1" }) };
const request = (data: unknown) => new Request("http://localhost/api/comandas/pg1/pagamentos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
const pg = { comandaId: "cmd1", gatewayPedidoId: "or_1", forma: "DEBITO", antecipadoId: null, linkPagamentoId: null };
beforeEach(() => {
  vi.resetAllMocks(); m.papel = "RECEPCAO"; m.barbeiroId = null; m.modo = "stone";
  m.exigir.mockImplementation(async (papeis: Papel[] = ["DONO", "GERENTE", "RECEPCAO", "LIDER", "BARBEIRO"]) => {
    if (!m.papel) throw new ErroNegocio("Sem sessão", 401);
    if (!papeis.includes(m.papel)) throw new ErroNegocio("Proibido", 403);
    return { usuarioId: "u1", papel: m.papel, nome: "Teste", barbeiroId: m.barbeiroId, clienteId: null };
  });
  m.pagamento.mockResolvedValue(pg); m.detalhe.mockResolvedValue({ id: "cmd1" }); m.maquinas.mockReturnValue([]);
});
describe("autorização nas rotas de cobrança POS", () => {
  it.each([null, "CLIENTE", "LIDER"] as const)("bloqueia %s antes de consultar ou modificar cobrança", async papel => {
    m.papel = papel;
    expect((await GET()).status).toBe(papel ? 403 : 401);
    expect((await POST(request({ forma: "PIX", valorCentavos: 1000 }), ctx)).status).toBe(papel ? 403 : 401);
    for (const acao of ["conferir", "cancelar", "simular"]) expect((await PATCH(request({ acao }), ctx)).status).toBe(papel ? 403 : 401);
    expect(m.pagamento).not.toHaveBeenCalled(); expect(m.registrar).not.toHaveBeenCalled(); expect(m.cancelar).not.toHaveBeenCalled(); expect(m.maquinas).not.toHaveBeenCalled();
  });
  it.each(["DONO", "GERENTE", "RECEPCAO"] as const)("permite %s no balcão e aplica a lista explícita", async papel => {
    m.papel = papel;
    expect((await GET()).status).toBe(200);
    expect((await POST(request({ forma: "DEBITO", valorCentavos: 1000 }), ctx)).status).toBe(201);
    expect((await PATCH(request({ acao: "conferir" }), ctx)).status).toBe(200);
    expect(m.exigir).toHaveBeenCalledWith(["DONO", "GERENTE", "RECEPCAO"]);
    expect(m.registrar).toHaveBeenCalledOnce(); expect(m.conferir).toHaveBeenCalledOnce();
  });
  it("o barbeiro confirma o pedido integrado de seu próprio atendimento", async () => {
    m.papel = "BARBEIRO"; m.barbeiroId = "b1"; m.comanda.mockResolvedValue({ id: "cmd1" });
    expect((await PATCH(request({ acao: "conferir" }), ctx)).status).toBe(200);
    expect(m.conferir).toHaveBeenCalledWith("or_1");
    expect(m.detalhe).toHaveBeenCalledWith("cmd1");
  });
  it("o barbeiro não confere comanda alheia", async () => {
    m.papel = "BARBEIRO"; m.barbeiroId = "b1"; m.comanda.mockResolvedValue(null);
    expect((await PATCH(request({ acao: "conferir" }), ctx)).status).toBe(403);
    expect(m.conferir).not.toHaveBeenCalled(); expect(m.detalhe).not.toHaveBeenCalled();
  });
  it.each([{ linkPagamentoId: "link" }, { antecipadoId: "ant" }, { gatewayPedidoId: "sim_1" }, { forma: "PIX" }])("não confere outra modalidade pelo acesso do barbeiro: %j", async (extra) => {
    m.papel = "BARBEIRO"; m.barbeiroId = "b1";
    m.pagamento.mockResolvedValue({ ...pg, ...extra });
    expect((await PATCH(request({ acao: "conferir" }), ctx)).status).toBe(403);
    expect(m.conferir).not.toHaveBeenCalled();
  });
  it("o barbeiro não lista terminais, cancela nem simula, e o modo manual veda a conferência", async () => {
    m.papel = "BARBEIRO"; m.barbeiroId = "b1";
    expect((await GET()).status).toBe(403);
    for (const acao of ["cancelar", "simular"]) expect((await PATCH(request({ acao }), ctx)).status).toBe(403);
    m.modo = "manual";
    expect((await PATCH(request({ acao: "conferir" }), ctx)).status).toBe(403);
    expect(m.pagamento).not.toHaveBeenCalled(); expect(m.conferir).not.toHaveBeenCalled();
  });
});
