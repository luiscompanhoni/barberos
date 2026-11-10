import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST, DELETE } from "@/app/api/cliente/espera/route";
import { ErroNegocio } from "@/lib/erros";

const m = vi.hoisted(() => ({ sessao: vi.fn(), entrar: vi.fn(), listar: vi.fn(), sair: vi.fn() }));
vi.mock("@/lib/auth/sessao", () => ({ exigirCliente: m.sessao }));
vi.mock("@/lib/crescimento/espera", () => ({ entrarNaEspera: m.entrar, esperasDoCliente: m.listar, sairDaEspera: m.sair }));
const publico = { data: "2026-11-11", servicoId: "corte", servicosAdicionais: ["barba"], barbeiroId: "b", periodo: "NOITE" };
const req = (body: unknown) => new Request("http://localhost/api/cliente/espera", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const SITE = "https://app.black.example";

describe("API de aviso do cliente", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("SITE_URL", SITE); m.sessao.mockResolvedValue({ usuarioId: "usuario", clienteId: "cliente", sessaoVersao: 2 }); m.entrar.mockResolvedValue({ id: "pedido" }); m.listar.mockResolvedValue([]); m.sair.mockResolvedValue(undefined); });
  afterEach(() => vi.unstubAllEnvs());
  it("injeta identidade e versão exclusivamente da sessão autenticada", async () => {
    const r = await POST(req(publico));
    expect(r.status).toBe(201);
    expect(m.entrar).toHaveBeenCalledWith("cliente", { ...publico, origem: "SITE" }, { clienteId: "cliente", titular: { usuarioId: "usuario", sessaoVersao: 2 } });
  });
  it.each([{ clienteId: "outra" }, { app: { clienteId: "outra" } }, { esperaId: "bypass" }, { origem: "BOT" }])("não aceita identidade, origem ou exceção interna no corpo: %j", async extra => {
    expect((await POST(req({ ...publico, ...extra }))).status).toBe(400);
    expect(m.entrar).not.toHaveBeenCalled();
  });
  it("sem sessão não lista nem registra pedidos", async () => {
    m.sessao.mockRejectedValue(new ErroNegocio("Entre no sistema", 401));
    expect((await GET()).status).toBe(401);
    expect((await POST(req(publico))).status).toBe(401);
    expect(m.listar).not.toHaveBeenCalled(); expect(m.entrar).not.toHaveBeenCalled();
  });
  it("listagem e cancelamento usam o cliente da sessão, com erro de domínio preservado", async () => {
    await GET(); expect(m.listar).toHaveBeenCalledWith("cliente");
    m.sair.mockRejectedValue(new ErroNegocio("Espera não encontrada", 404));
    const r = await DELETE(new Request("http://localhost/api/cliente/espera?id=outro-pedido", { method: "DELETE" }));
    expect(r.status).toBe(404);
    expect(m.sair).toHaveBeenCalledWith("cliente", "outro-pedido", { clienteId: "cliente", titular: { usuarioId: "usuario", sessaoVersao: 2 } });
  });
  it("orientação para ativar avisos chega ao cliente com código próprio", async () => {
    m.entrar.mockRejectedValue(new ErroNegocio("Ative os avisos automáticos em Perfil > Meus dados para pedir este aviso.", 422, "avisos_desativados"));
    const r = await POST(req(publico));
    expect(r.status).toBe(422);
    expect(await r.json()).toMatchObject({ codigo: "avisos_desativados", erro: "Ative os avisos automáticos em Perfil > Meus dados para pedir este aviso." });
  });
  it.each([
    { origin: "https://outro.app.black.example", "sec-fetch-site": "same-site" },
    { origin: "https://externo.example", "sec-fetch-site": "cross-site" },
    { origin: SITE, "sec-fetch-site": "cross-site" },
    { origin: "null", "sec-fetch-site": "same-site" },
  ])("recusa criação e cancelamento de outra origem antes do domínio: %j", async headers => {
    const criar = new Request("http://localhost/api/cliente/espera", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(publico) });
    const cancelar = new Request("http://localhost/api/cliente/espera?id=pedido", { method: "DELETE", headers });
    expect((await POST(criar)).status).toBe(403);
    expect((await DELETE(cancelar)).status).toBe(403);
    expect(m.entrar).not.toHaveBeenCalled(); expect(m.sair).not.toHaveBeenCalled();
  });
  it("aceita a origem do cliente sem abrir a criação para text/plain", async () => {
    const criar = new Request(`${SITE}/api/cliente/espera`, { method: "POST", headers: { origin: SITE, "content-type": "text/plain" }, body: JSON.stringify(publico) });
    expect((await POST(criar)).status).toBe(415);
    expect(m.entrar).not.toHaveBeenCalled();
  });
  it("mantém criação e cancelamento JSON pela origem válida do cliente", async () => {
    const criar = new Request(`${SITE}/api/cliente/espera`, { method: "POST", headers: { origin: SITE, "sec-fetch-site": "same-origin", "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(publico) });
    const cancelar = new Request(`${SITE}/api/cliente/espera?id=pedido`, { method: "DELETE", headers: { origin: SITE, "sec-fetch-site": "same-origin" } });
    expect((await POST(criar)).status).toBe(201);
    expect((await DELETE(cancelar)).status).toBe(200);
    expect(m.entrar).toHaveBeenCalledOnce(); expect(m.sair).toHaveBeenCalledOnce();
  });
  it("limita o corpo antes da validação, mesmo sem Content-Length", async () => {
    const criar = new Request(`${SITE}/api/cliente/espera`, { method: "POST", headers: { origin: SITE, "content-type": "application/json" }, body: " ".repeat(8193) + JSON.stringify(publico) });
    expect((await POST(criar)).status).toBe(413);
    expect(m.entrar).not.toHaveBeenCalled();
  });
});
