import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ exigir: vi.fn(), vagas: vi.fn(), lista: vi.fn(), receber: vi.fn(), mudar: vi.fn() }));
vi.mock("@/lib/auth/sessao", () => ({ GESTAO: ["DONO", "GERENTE"], exigirSessao: m.exigir }));
vi.mock("@/lib/db", () => ({ db: { vagaRecrutamento: { findMany: m.vagas }, candidaturaRecrutamento: { count: m.lista, findMany: m.lista } } }));
vi.mock("@/lib/auditoria", () => ({ auditar: vi.fn() }));
vi.mock("@/lib/recrutamento/servico", () => ({ receberCandidatura: m.receber, mudarEtapa: m.mudar, criarVaga: vi.fn() }));
import { GET as vagas } from "@/app/api/recrutamento/vagas/route";
import { GET as candidatos } from "@/app/api/recrutamento/candidaturas/route";
import { PATCH } from "@/app/api/recrutamento/candidaturas/[id]/route";
import { POST } from "@/app/api/recrutamento/publico/[vagaId]/route";
import { ErroNegocio } from "@/lib/erros";
import { _zerarLimites } from "@/lib/limite";
import { ehPaginaDoSite } from "@/lib/dominios";
beforeEach(() => { vi.resetAllMocks(); _zerarLimites(); });
describe("acesso ao recrutamento", () => {
  it.each([401, 403])("bloqueia leitura sem permissão %s", async (status) => {
    m.exigir.mockRejectedValue(new ErroNegocio("Sem acesso", status));
    expect((await vagas()).status).toBe(status); expect((await candidatos(new Request("http://localhost/api/recrutamento/candidaturas"))).status).toBe(status);
    expect(m.exigir).toHaveBeenCalledWith(["DONO", "GERENTE"]); expect(m.vagas).not.toHaveBeenCalled(); expect(m.lista).not.toHaveBeenCalled();
  });
  it("bloqueia alteração sem permissão", async () => {
    m.exigir.mockRejectedValue(new ErroNegocio("Sem acesso", 403));
    expect((await PATCH(new Request("http://localhost/api/recrutamento/candidaturas/c", { method: "PATCH" }), { params: Promise.resolve({ id: "c" }) })).status).toBe(403); expect(m.mudar).not.toHaveBeenCalled();
  });
  it("separa formulário público de painel", () => { expect(ehPaginaDoSite("/vagas/vaga")).toBe(true); expect(ehPaginaDoSite("/recrutamento")).toBe(false); expect(ehPaginaDoSite("/vagas-falsas/1")).toBe(false); });
});
describe("API pública", () => {
  const ctx = { params: Promise.resolve({ vagaId: "vaga" }) };
  const req = (body: string) => new Request("http://localhost/api/recrutamento/publico/vaga", { method: "POST", body });
  it("limita bytes reais mesmo sem Content-Length", async () => { expect((await POST(req("x".repeat(20001)), ctx)).status).toBe(413); expect(m.receber).not.toHaveBeenCalled(); });
  it("recusa JSON inválido", async () => { expect((await POST(req("{erro"), ctx)).status).toBe(400); expect(m.receber).not.toHaveBeenCalled(); });
  it("responde sem dados privados", async () => {
    const r = await POST(req(JSON.stringify({ envioId: "37f1774b-6347-481c-b685-b0b0cf4f61ab", nome: "Teste profissional", telefone: "11999998888", cidade: "Rio do Sul", experienciaMeses: 12, servicos: ["Barba"], disponibilidade: "Segunda a sexta", cienciaPrivacidade: true })), ctx);
    expect(r.status).toBe(201); expect(await r.json()).toEqual({ recebido: true }); expect(r.headers.get("Cache-Control")).toBe("no-store");
  });
  it("limita tentativas repetidas", async () => { for (let i = 0; i < 5; i++) await POST(req("{}"), ctx); expect((await POST(req("{}"), ctx)).status).toBe(429); });
  it("campo-isca preenchido: responde como aceito e não grava", async () => {
    const r = await POST(req(JSON.stringify({ envioId: "37f1774b-6347-481c-b685-b0b0cf4f61ab", nome: "Robo", telefone: "11999998888", cidade: "Rio do Sul", experienciaMeses: 1, servicos: ["Barba"], disponibilidade: "Sempre", cienciaPrivacidade: true, site: "http://spam" })), ctx);
    expect(r.status).toBe(201); expect(m.receber).not.toHaveBeenCalled();
  });
  it("teto por vaga vale mesmo trocando de IP", async () => {
    const deIp = (i: number) => new Request("http://localhost/api/recrutamento/publico/vaga", { method: "POST", body: "{}", headers: { "x-forwarded-for": "10.0.0." + i } });
    for (let i = 0; i < 100; i++) await POST(deIp(i), ctx);
    expect((await POST(deIp(200), ctx)).status).toBe(429);
  });
});
