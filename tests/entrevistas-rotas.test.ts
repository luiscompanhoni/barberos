import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErroNegocio } from "@/lib/erros";
const m = vi.hoisted(() => ({ auth: vi.fn(), criar: vi.fn(), gerir: vi.fn(), candidato: vi.fn(), listar: vi.fn() }));
vi.mock("@/lib/auth/sessao", () => ({ GESTAO: ["DONO", "GERENTE"], exigirSessao: m.auth }));
vi.mock("@/lib/db", () => ({ db: { entrevistaRecrutamento: { findMany: m.listar } } }));
vi.mock("@/lib/recrutamento/entrevistas", () => ({ criarConviteEntrevista: m.criar, candidatoEntrevista: m.candidato }));
vi.mock("@/lib/recrutamento/entrevistas-gestao", () => ({ gerirEntrevista: m.gerir, linkEntrevista: () => "link-privado" }));
vi.mock("@/lib/limite", () => ({ limitar: vi.fn() }));
import { POST as convite, GET as listar } from "@/app/api/recrutamento/candidaturas/[id]/entrevistas/route";
import { POST as gerir } from "@/app/api/recrutamento/entrevistas/[id]/route";
import { POST as confirmar } from "@/app/api/recrutamento/entrevistas/confirmacao/route";
const ctx = { params: Promise.resolve({ id: "fixture" }) };
const req = (body: unknown) => new Request("http://local/api", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); m.auth.mockResolvedValue({ usuarioId: "gerente", papel: "GERENTE" }); m.listar.mockResolvedValue([]); });
describe("permissões e superfície pública de entrevistas", () => {
  it.each([401,403])("nega acesso %s antes de consultar ou gravar", async status => {
    m.auth.mockRejectedValue(new ErroNegocio("Acesso negado", status));
    expect((await convite(req({}),ctx)).status).toBe(status);
    expect((await gerir(req({}),ctx)).status).toBe(status);
    expect((await listar(req({}),ctx)).status).toBe(status);
    expect(m.criar).not.toHaveBeenCalled(); expect(m.gerir).not.toHaveBeenCalled(); expect(m.listar).not.toHaveBeenCalled();
  });
  it("edições pedem exclusivamente DONO", async () => {
    await convite(req({}),ctx); expect(m.auth).toHaveBeenLastCalledWith(["DONO"]);
    await gerir(req({}),ctx); expect(m.auth).toHaveBeenLastCalledWith(["DONO"]);
  });
  it("gerente não recebe link privado nem controle de escrita", async () => {
    m.listar.mockResolvedValue([{ id:"e", donoId:"gerente", tokenHash:"irrelevante", estado:"CONVIDADO", expiraEm:new Date("2031-01-01") }]);
    const r=await listar(req({}),ctx); const b=await r.json();
    expect(b.podeMarcar).toBe(false); expect(b.entrevistas[0].link).toBeNull(); expect(b.entrevistas[0].podeGerir).toBe(false);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
  it.each([{ token:"x", pedido:{acao:"CONSULTAR"} },{token:"a".repeat(43),pedido:{acao:"CONFIRMAR",versao:-1}},{token:"a".repeat(43),pedido:{acao:"CONSULTAR"},nota:10}])("rejeita corpo inválido sem executar negócio", async b => {
    const r=await confirmar(req(b)); expect(r.status).toBe(400); expect(m.candidato).not.toHaveBeenCalled(); expect(r.headers.get("cache-control")).toBe("no-store"); expect(r.headers.get("referrer-policy")).toBe("no-referrer");
  });
  it("limita também corpo recebido por streaming", async () => {
    const r=await confirmar(req({token:"a".repeat(17000)})); expect(r.status).toBe(413); expect(m.candidato).not.toHaveBeenCalled();
  });
  it("traduz conflito e preserva cabeçalhos de privacidade", async () => {
    m.candidato.mockRejectedValue(new ErroNegocio("Horário ocupado",409));
    const r=await confirmar(req({token:"a".repeat(43),pedido:{acao:"CONFIRMAR",versao:1}})); expect(r.status).toBe(409); expect(r.headers.get("cache-control")).toBe("no-store");
  });
});
