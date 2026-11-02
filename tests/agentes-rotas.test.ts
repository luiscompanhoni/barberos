import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ sessao: vi.fn(), painel: vi.fn(), criar: vi.fn(), configurar: vi.fn(), decidir: vi.fn(), processar: vi.fn(), criarRotina: vi.fn(), alterarRotina: vi.fn() }));
vi.mock("@/lib/auth/sessao", () => ({ exigirSessao: m.sessao }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/agentes/servico", () => ({ painelAgentes: m.painel, criarExecucao: m.criar, configurarAgentes: m.configurar, decidirExecucao: m.decidir }));
vi.mock("@/lib/agentes/processar", () => ({ processarUmaExecucao: m.processar }));
vi.mock("@/lib/agentes/rotinas", () => ({ criarRotinaAgente: m.criarRotina, alterarRotinaAgente: m.alterarRotina }));
import { GET, POST, PATCH } from "@/app/api/agentes/route";
import { POST as decidir } from "@/app/api/agentes/[id]/route";
import { POST as processar } from "@/app/api/agentes/processar/route";
import { POST as rotina } from "@/app/api/agentes/rotinas/route";
import { PATCH as alterarRotina } from "@/app/api/agentes/rotinas/[id]/route";
import { ErroNegocio } from "@/lib/erros";
const origin = "https://painel.example";
const tarefa = { agenteId: "conteudo", tarefa: "Preparar roteiro sintético para revisão", chave: "chave-teste-rotas" };
const req = (body: unknown = {}, headers: Record<string, string> = {}) => new Request(origin + "/api/agentes", { method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const ctx = { params: Promise.resolve({ id: "tarefa-1" }) };
const mutacoes = [() => POST(req(tarefa)), () => PATCH(req({ pausada: true, limiteDiario: 10, revisao: 0 })), () => decidir(req({ acao: "cancelar", revisao: 0 }), ctx), () => processar(req()), () => rotina(req({ ...tarefa, nome: "Diária", cadaMinutos: 1440 })), () => alterarRotina(req({ ativa: false, revisao: 0 }), ctx)];
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("AGENTES_HABILITADOS", "true"); vi.stubEnv("PAINEL_URL", origin);
  m.sessao.mockResolvedValue({ usuarioId: "dono-1", papel: "DONO" });
  for (const [nome, mock] of Object.entries(m)) if (nome !== "sessao") mock.mockResolvedValue({ ok: true });
});
afterEach(() => vi.unstubAllEnvs());
describe("rotas da central de agentes", () => {
  it.each([401, 403])("bloqueia leitura e todas as mutações sem sessão autorizada (%s)", async status => {
    m.sessao.mockRejectedValue(new ErroNegocio("Acesso recusado", status));
    expect((await GET()).status).toBe(status);
    for (const executar of mutacoes) expect((await executar()).status).toBe(status);
    for (const [nome, mock] of Object.entries(m)) if (nome !== "sessao") expect(mock).not.toHaveBeenCalled();
  });
  it("feature desligada não consulta ou modifica tarefas", async () => {
    vi.stubEnv("AGENTES_HABILITADOS", "false");
    expect((await GET()).status).toBe(503);
    for (const executar of mutacoes) expect((await executar()).status).toBe(503);
    expect(m.criar).not.toHaveBeenCalled(); expect(m.processar).not.toHaveBeenCalled();
  });
  it("origem externa não chega aos serviços", async () => {
    const variantes: Record<string, string>[] = [{ origin: "https://externo.example" }, { origin: "null" }, { "sec-fetch-site": "cross-site" }];
    for (const headers of variantes) {
      expect((await POST(req(tarefa, headers))).status).toBe(403);
      expect((await processar(req({}, headers))).status).toBe(403);
    }
    expect(m.criar).not.toHaveBeenCalled(); expect(m.processar).not.toHaveBeenCalled();
  });
  it("usa dono da sessão, valida campos e limita corpo", async () => {
    expect((await GET()).headers.get("cache-control")).toBe("private, no-store");
    expect(m.sessao).toHaveBeenCalledWith(["DONO"]); expect(m.painel).toHaveBeenCalledWith("dono-1");
    expect((await POST(req(tarefa))).status).toBe(201); expect(m.criar).toHaveBeenCalledWith("dono-1", tarefa);
    m.criar.mockClear();
    expect((await POST(req({ ...tarefa, usuarioId: "outro" }))).status).toBe(400);
    expect((await POST(req({ ...tarefa, tarefa: "x".repeat(33000) }))).status).toBe(413);
    expect(m.criar).not.toHaveBeenCalled();
  });
});
