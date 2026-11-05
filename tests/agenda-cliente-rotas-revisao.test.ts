import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ sessao: vi.fn(), agendar: vi.fn(), remarcar: vi.fn(), cancelar: vi.fn(), cliente: vi.fn() }));
vi.mock("@/lib/auth/sessao", () => ({ exigirCliente: m.sessao }));
vi.mock("@/lib/agenda/cliente", () => ({ agendarPeloCliente: m.agendar, remarcarPeloCliente: m.remarcar, cancelarPeloCliente: m.cancelar, proximosDoCliente: vi.fn(), historicoDoCliente: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { cliente: { findUniqueOrThrow: m.cliente } } }));
vi.mock("@/lib/agenda/antecipado", () => ({ antecipadoDisponivel: vi.fn() }));
vi.mock("@/lib/pagamentos/checkout", () => ({ checkoutProprio: vi.fn() }));
vi.mock("@/lib/jogos/premios", () => ({ premiosParaReservar: vi.fn() }));
import { POST } from "@/app/api/cliente/agendamentos/route";
import { PATCH, DELETE } from "@/app/api/cliente/agendamentos/[id]/route";
import { ErroNegocio } from "@/lib/erros";
const origem = "https://cliente.example.test";
const novo = { servicoId: "corte", barbeiroId: "b", inicio: "2030-01-02T12:00:00Z", duracaoEsperadaMin: 50 };
const ctx = { params: Promise.resolve({ id: "ag" }) };
const req = (method: string, body?: unknown, origin = origem) => new Request(`${origem}/api/cliente/agendamentos/ag`, {
  method, headers: { origin, "content-type": "text/plain" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("SITE_URL", origem);
  m.sessao.mockResolvedValue({ usuarioId: "u", clienteId: "c", sessaoVersao: 7 });
  m.cliente.mockResolvedValue({ id: "c", nome: "Cliente", telefone: "5511999990000" });
  m.agendar.mockResolvedValue({ id: "ag" }); m.remarcar.mockResolvedValue({ id: "ag" });
});
afterEach(() => vi.unstubAllEnvs());

describe("contratos das mutações de agenda do cliente", () => {
  it.each(["https://externo.example.test", "https://outro.cliente.example.test", "null"])("recusa origem %s antes de acessar domínio ou cadastro", async origin => {
    expect((await POST(req("POST", novo, origin))).status).toBe(403);
    expect((await PATCH(req("PATCH", { inicio: novo.inicio }, origin), ctx)).status).toBe(403);
    expect((await DELETE(req("DELETE", undefined, origin), ctx)).status).toBe(403);
    expect(m.cliente).not.toHaveBeenCalled(); expect(m.agendar).not.toHaveBeenCalled(); expect(m.remarcar).not.toHaveBeenCalled(); expect(m.cancelar).not.toHaveBeenCalled();
  });
  it("limita tamanho e rejeita identidade enviada pelo cliente", async () => {
    expect((await POST(req("POST", { ...novo, extra: "x".repeat(33000) }))).status).toBe(413);
    expect((await PATCH(req("PATCH", { inicio: novo.inicio, extra: "x".repeat(33000) }), ctx)).status).toBe(413);
    expect((await POST(req("POST", { ...novo, clienteId: "outra-pessoa" }))).status).toBe(400);
    expect(m.agendar).not.toHaveBeenCalled(); expect(m.remarcar).not.toHaveBeenCalled();
  });
  it("encaminha identidade e versão da sessão nas três mutações", async () => {
    expect((await POST(req("POST", novo))).status).toBe(201);
    expect(m.agendar).toHaveBeenCalledWith(expect.objectContaining({ clienteId: "c", usuarioId: "u", sessaoVersao: 7, origem: "SITE", duracaoEsperadaMin: 50 }));
    expect((await PATCH(req("PATCH", { inicio: novo.inicio, precoEsperadoCentavos: 8000, duracaoEsperadaMin: 50 }), ctx)).status).toBe(200);
    expect(m.remarcar).toHaveBeenCalledWith("c", "ag", new Date(novo.inicio), undefined, undefined, 8000, { usuarioId: "u", sessaoVersao: 7 }, 50);
    expect((await DELETE(req("DELETE"), ctx)).status).toBe(200);
    expect(m.cancelar).toHaveBeenCalledWith("c", "ag", { usuarioId: "u", sessaoVersao: 7 });
  });
  it.each([undefined, null, 0, 4, 50.5, 481, "50"])("recusa duração ausente ou inválida %s antes de reservar ou remarcar", async duracaoEsperadaMin => {
    expect((await POST(req("POST", { ...novo, duracaoEsperadaMin }))).status).toBe(400);
    expect((await PATCH(req("PATCH", { inicio: novo.inicio, duracaoEsperadaMin }), ctx)).status).toBe(400);
    expect(m.agendar).not.toHaveBeenCalled(); expect(m.remarcar).not.toHaveBeenCalled();
  });
  it("retorna conflito para renovar o resumo quando a duração muda e o preço permanece igual", async () => {
    const erro = new ErroNegocio("A duração mudou.", 409, "duracao_alterada");
    m.agendar.mockRejectedValue(erro); m.remarcar.mockRejectedValue(erro);
    for (const resposta of [await POST(req("POST", { ...novo, precoEsperadoCentavos: 8000 })),
      await PATCH(req("PATCH", { inicio: novo.inicio, precoEsperadoCentavos: 8000, duracaoEsperadaMin: 50 }), ctx)]) {
      expect(resposta.status).toBe(409); expect((await resposta.json()).codigo).toBe("duracao_alterada");
    }
  });
});
