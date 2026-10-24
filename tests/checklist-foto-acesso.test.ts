import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/checklist/fotos/[itemId]/route";
import { ErroNegocio } from "@/lib/erros";

const m = vi.hoisted(() => ({
  sessao: vi.fn(), pessoa: vi.fn(), item: vi.fn(), itemPessoa: vi.fn(),
  fotos: vi.fn(), contar: vi.fn(), criar: vi.fn(),
}));
vi.mock("@/lib/auth/sessao", () => ({ BALCAO: ["DONO", "GERENTE", "RECEPCAO"], exigirSessao: m.sessao }));
vi.mock("@/lib/auditoria", () => ({ auditar: vi.fn() }));
vi.mock("@/lib/db", () => {
  const tx = { $queryRaw: vi.fn(), checklistItem: { findUniqueOrThrow: m.item }, checklistFoto: { count: m.contar, create: m.criar } };
  return { db: { checklistPessoa: { findUnique: m.pessoa }, checklistItem: { findFirst: m.itemPessoa, findUnique: m.item },
    checklistFoto: { findMany: m.fotos }, $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } };
});
const ctx = { params: Promise.resolve({ itemId: "tarefa" }) };
const dataUrl = `data:image/png;base64,${Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64")}`;
const post = () => POST(new Request("http://localhost/api/checklist/fotos/tarefa", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dataUrl }),
}), ctx);

describe("privacidade das fotos do checklist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.sessao.mockResolvedValue({ usuarioId: "gestor" });
    m.pessoa.mockResolvedValue({ id: "pessoa", ativo: true });
    m.item.mockResolvedValue({ id: "tarefa", avaliacao: null });
    m.itemPessoa.mockResolvedValue(null);
    m.fotos.mockResolvedValue([]); m.contar.mockResolvedValue(0);
  });
  it("link pessoal não consulta fotos de outra pessoa", async () => {
    const r = await GET(new Request("http://localhost/api/checklist/fotos/tarefa?token=pessoal"), ctx);
    expect(r.status).toBe(404); expect(m.fotos).not.toHaveBeenCalled();
  });
  it("sem link exige sessão autorizada", async () => {
    m.sessao.mockRejectedValue(new ErroNegocio("Entre no sistema", 401));
    const r = await GET(new Request("http://localhost/api/checklist/fotos/tarefa"), ctx);
    expect(r.status).toBe(401); expect(m.fotos).not.toHaveBeenCalled();
  });
  it("resposta autorizada não pode ser armazenada em cache público", async () => {
    const r = await GET(new Request("http://localhost/api/checklist/fotos/tarefa"), ctx);
    expect(r.status).toBe(200); expect(r.headers.get("cache-control")).toBe("private, no-store");
  });
  it("preserva evidência validada e limita três anexos", async () => {
    m.item.mockResolvedValue({ id: "tarefa", avaliacao: "VALIDADO" });
    expect((await post()).status).toBe(409);
    m.item.mockResolvedValue({ id: "tarefa", avaliacao: null }); m.contar.mockResolvedValue(3);
    expect((await post()).status).toBe(409); expect(m.criar).not.toHaveBeenCalled();
  });
  it("adiciona foto opcional sem alterar conclusão ou pontuação", async () => {
    expect((await post()).status).toBe(201); expect(m.criar).toHaveBeenCalledOnce();
  });
});
