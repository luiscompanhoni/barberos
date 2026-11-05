import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ sessao: vi.fn(), listar: vi.fn(), cadastrar: vi.fn(), editar: vi.fn(), detalhar: vi.fn() }));
vi.mock("@/lib/auth/sessao", () => ({ BALCAO: ["DONO", "GERENTE", "RECEPCAO"], exigirSessao: m.sessao }));
vi.mock("@/lib/clientes/gestao", () => ({ listarClientes: m.listar, cadastrarCliente: m.cadastrar, editarCliente: m.editar, detalharCliente: m.detalhar }));
import { GET, POST } from "@/app/api/clientes/gestao/route";
import { PATCH } from "@/app/api/clientes/gestao/[id]/route";
import { ErroNegocio } from "@/lib/erros";
beforeEach(() => { vi.clearAllMocks(); m.sessao.mockResolvedValue({ usuarioId: "recepcao" }); m.listar.mockResolvedValue({ clientes: [] }); vi.stubEnv("PAINEL_URL", "http://localhost:3015"); });
it("exige balcão antes de qualquer leitura", async () => {
  m.sessao.mockRejectedValue(new ErroNegocio("Sem acesso", 403));
  expect((await GET(new Request("http://localhost:3015/api/clientes/gestao"))).status).toBe(403);
  expect(m.listar).not.toHaveBeenCalled();
  expect(m.sessao).toHaveBeenCalledWith(["DONO", "GERENTE", "RECEPCAO"]);
});
it("não permite cache público da ficha", async () => {
  const r = await GET(new Request("http://localhost:3015/api/clientes/gestao"));
  expect(r.headers.get("cache-control")).toBe("private, no-store");
});
it("recusa alteração de cadastro de origem externa", async () => {
  const req = new Request("http://localhost:3015/api/clientes/gestao/abc", { method: "PATCH", headers: { origin: "https://externo.invalid", "content-type": "application/json" }, body: JSON.stringify({ nome: "Novo nome" }) });
  const r = await PATCH(req, { params: Promise.resolve({ id: "abc" }) });
  expect(r.status).toBe(403); expect(m.editar).not.toHaveBeenCalled();
});
it("recusa campos que concederiam acesso ou papel no cadastro", async () => {
  const r = await POST(new Request("http://localhost:3015/api/clientes/gestao", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nome: "Teste", telefone: "11999990000", papel: "DONO" }) }));
  expect(r.status).toBe(400); expect(m.cadastrar).not.toHaveBeenCalled();
});
