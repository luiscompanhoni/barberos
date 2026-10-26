import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST, PATCH } from "@/app/api/meu-financeiro/route";
import { ErroNegocio } from "@/lib/erros";
const m = vi.hoisted(() => ({ sessao: vi.fn(), listar: vi.fn(), criar: vi.fn(), alterar: vi.fn() }));
vi.mock("@/lib/auth/sessao", () => ({ exigirSessao: m.sessao }));
vi.mock("@/lib/db", () => ({ db: { lancamentoPessoal: { findMany: m.listar, create: m.criar, updateMany: m.alterar } } }));
const req = (body: unknown) => new Request("http://localhost/api/meu-financeiro", { method:"POST", headers:{"content-type":"application/json"},body:JSON.stringify(body) });
describe("financeiro pessoal isolado", () => {
  beforeEach(() => { vi.clearAllMocks(); m.sessao.mockResolvedValue({ usuarioId:"eu" }); m.listar.mockResolvedValue([]); m.criar.mockResolvedValue({ id:"novo" }); });
  it("consulta apenas o dono da sessão e não permite cache compartilhado", async () => {
    const r = await GET(new Request("http://localhost/api/meu-financeiro?mes=2026-10&usuarioId=outro"));
    expect(r.status).toBe(200); expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(m.listar.mock.calls[0][0].where).toMatchObject({ usuarioId:"eu", anulado:false });
  });
  it("recusa acesso sem sessão", async () => { m.sessao.mockRejectedValue(new ErroNegocio("Entre",401)); expect((await GET(new Request("http://localhost/api/meu-financeiro?mes=2026-10"))).status).toBe(401); expect(m.listar).not.toHaveBeenCalled(); });
  it("ignora dono enviado pelo cliente e rejeita data inexistente", async () => {
    const b = {tipo:"RECEITA",descricao:"Comissão",categoria:"Trabalho",valorCentavos:30000,data:"2026-10-21",realizado:true,usuarioId:"outro"};
    expect((await POST(req(b))).status).toBe(201); expect(m.criar.mock.calls[0][0].data.usuarioId).toBe("eu");
    expect((await POST(req({...b,data:"2026-02-30"}))).status).toBe(400);
  });
  it("anulação e restauração sempre filtram pelo dono", async () => {
    expect((await PATCH(req({id:"de-outro",anulado:true}))).status).toBe(200);
    expect(m.alterar).toHaveBeenCalledWith({where:{id:"de-outro",usuarioId:"eu"},data:{anulado:true}});
  });
});
