import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErroNegocio } from "@/lib/erros";
const m = vi.hoisted(() => ({ cliente: vi.fn(), equipe: vi.fn(), listar: vi.fn(), criar: vi.fn(), cancelar: vi.fn(), decidir: vi.fn() }));
vi.mock("@/lib/auth/sessao", () => ({ exigirCliente: m.cliente, exigirSessao: m.equipe, BALCAO: ["DONO", "GERENTE", "RECEPCAO"] }));
vi.mock("@/lib/agenda/pedidos", () => ({ listarPedidos: m.listar, criarPedido: m.criar, cancelarPedido: m.cancelar, decidirPedido: m.decidir }));
vi.mock("@/lib/dominios", () => ({ urlSite: () => "https://app.black.test", urlPainel: () => "https://painel.black.test" }));
import { GET, POST, PATCH } from "@/app/api/cliente/pedidos-agendamento/route";
import { GET as GETEquipe, PATCH as PATCHEquipe } from "@/app/api/pedidos-agendamento/route";

const body = { chave: "970d1869-1e8f-4f11-b8eb-fb5a7fd5b46f", servicoIds: ["corte", "barba"], barbeiroId: null, dataPreferida: "2026-11-05", horaPreferida: "14:00" };
const req = (body: unknown, method = "POST", origin = "https://app.black.test") => new Request(`${origin}/api/cliente/pedidos-agendamento`, { method, headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks();
  m.cliente.mockResolvedValue({ usuarioId: "u", clienteId: "c" }); m.equipe.mockResolvedValue({ usuarioId: "r", papel: "RECEPCAO" });
  m.listar.mockResolvedValue({ pedidos: [], profissionais: [] }); m.criar.mockResolvedValue({ id: "p", status: "PENDENTE" }); m.cancelar.mockResolvedValue({ id: "p", status: "CANCELADO" }); m.decidir.mockResolvedValue({ status: "APROVADO" });
});

describe("rotas de pedidos de agendamento", () => {
  it("consulta do cliente é limitada à identidade da sessão e não aceita clienteId enviado", async () => {
    expect((await GET()).status).toBe(200); expect(m.listar).toHaveBeenCalledWith("c");
    expect((await POST(req({ ...body, clienteId: "vitima" }))).status).toBe(400);
    expect(m.criar).not.toHaveBeenCalled();
  });
  it("só grava uma solicitação e retorna pendente, sem confirmação financeira ou agenda", async () => {
    const r = await POST(req(body)); expect(r.status).toBe(201); expect(await r.json()).toEqual({ id: "p", status: "PENDENTE" });
    expect(m.criar).toHaveBeenCalledWith("c", "u", { ...body, observacao: "" }, 0); expect(m.decidir).not.toHaveBeenCalled();
  });
  it("recusa usuário não autenticado antes de ler/gravar dados", async () => {
    m.cliente.mockRejectedValueOnce(new ErroNegocio("Entre", 401));
    expect((await POST(req(body))).status).toBe(401); expect(m.criar).not.toHaveBeenCalled();
  });
  it("recusa origem externa, inclusive outro subdomínio e origem null", async () => {
    for (const origin of ["https://malicioso.test", "https://outro.app.black.test", "null"]) {
      const r = new Request("https://app.black.test/api/cliente/pedidos-agendamento", { method: "POST", headers: { origin }, body: JSON.stringify(body) });
      expect((await POST(r)).status).toBe(403);
    }
    expect(m.criar).not.toHaveBeenCalled();
  });
  it("limita o corpo antes de executar o domínio", async () => {
    expect((await POST(req({ ...body, observacao: "x".repeat(40_000) }))).status).toBe(413); expect(m.criar).not.toHaveBeenCalled();
  });
  it("cancelamento sempre usa dono do pedido da sessão", async () => {
    expect((await PATCH(req({ id: "p", acao: "cancelar" }, "PATCH"))).status).toBe(200);
    expect(m.cancelar).toHaveBeenCalledWith("p", "c", "u", 0);
  });
  it("cancelamento encaminha a versão atual sem aceitar uma versão do corpo", async () => {
    m.cliente.mockResolvedValue({ usuarioId: "u", clienteId: "c", sessaoVersao: 7 });
    expect((await PATCH(req({ id: "p", acao: "cancelar" }, "PATCH"))).status).toBe(200);
    expect(m.cancelar).toHaveBeenCalledWith("p", "c", "u", 7);
    m.cancelar.mockClear();
    expect((await PATCH(req({ id: "p", acao: "cancelar", sessaoVersao: 7 }, "PATCH"))).status).toBe(400);
    expect(m.cancelar).not.toHaveBeenCalled();
  });
  it("lista da recepção exige os papéis do balcão", async () => {
    expect((await GETEquipe()).status).toBe(200); expect(m.equipe).toHaveBeenCalledWith(["DONO", "GERENTE", "RECEPCAO"]);
    expect(m.listar).toHaveBeenCalledWith();
  });
  it("aprovação exige confirmação explícita e origem do painel", async () => {
    const decisao = { id: "p", acao: "aprovar", barbeiroId: "b", inicio: "2026-11-05T17:00:00.000Z" };
    expect((await PATCHEquipe(req(decisao, "PATCH", "https://painel.black.test"))).status).toBe(400);
    expect((await PATCHEquipe(req({ ...decisao, conferido: true }, "PATCH"))).status).toBe(403);
    expect(m.decidir).not.toHaveBeenCalled();
    expect((await PATCHEquipe(req({ ...decisao, conferido: true }, "PATCH", "https://painel.black.test"))).status).toBe(400);
    expect(m.decidir).not.toHaveBeenCalled();
    expect((await PATCHEquipe(req({ ...decisao, conferido: true, precoEsperadoCentavos: 8000, duracaoEsperadaMin: 90, forcarAvulso: true }, "PATCH", "https://painel.black.test"))).status).toBe(200);
    expect(m.decidir).toHaveBeenCalledWith("p", expect.objectContaining({ papel: "RECEPCAO" }), expect.objectContaining({ inicio: new Date(decisao.inicio), conferido: true, precoEsperadoCentavos: 8000, duracaoEsperadaMin: 90, forcarAvulso: true }));
  });
  it("recepção sem permissão não consulta nem altera pedidos", async () => {
    m.equipe.mockRejectedValue(new ErroNegocio("Sem permissão", 403));
    expect((await GETEquipe()).status).toBe(403);
    expect((await PATCHEquipe(req({ id: "p", acao: "recusar" }, "PATCH", "https://painel.black.test"))).status).toBe(403);
    expect(m.listar).not.toHaveBeenCalled(); expect(m.decidir).not.toHaveBeenCalled();
  });
});
