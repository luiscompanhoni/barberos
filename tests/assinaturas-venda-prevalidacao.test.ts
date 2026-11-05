import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErroNegocio } from "@/lib/erros";
const m = vi.hoisted(() => ({ auth: vi.fn(), buscar: vi.fn(), criar: vi.fn(), verificar: vi.fn(), assinar: vi.fn() }));
vi.mock("@/lib/auth/sessao", () => ({ exigirSessao: m.auth, BALCAO: ["DONO", "GERENTE", "RECEPCAO"] }));
vi.mock("@/lib/db", () => ({ db: { cliente: { findUnique: m.buscar, upsert: m.criar } } }));
vi.mock("@/lib/assinaturas/servico", () => ({ assinar: m.assinar, verificarNovaAdesao: m.verificar }));
vi.mock("@/lib/whatsapp/conversas", () => ({ notificarEmSegundoPlano: vi.fn() }));
import { POST } from "@/app/api/assinaturas/route";
const req = () => new Request("http://local/api/assinaturas", { method: "POST", body: JSON.stringify({
  cliente: { telefone: "47999990000", nome: "Cliente teste" }, planoId: "p", forma: "PIX", enviarWhatsApp: false,
}) });
beforeEach(() => { vi.clearAllMocks(); m.auth.mockResolvedValue({ usuarioId: "u" }); m.buscar.mockResolvedValue(null); });
describe("pré-validação da venda", () => {
  it("nega cliente sem permissão antes de consultar ou criar", async () => {
    m.auth.mockRejectedValue(new ErroNegocio("Sem acesso", 403));
    expect((await POST(req())).status).toBe(403); expect(m.buscar).not.toHaveBeenCalled(); expect(m.criar).not.toHaveBeenCalled();
  });
  it("não cria cliente novo quando o plano é só para consulta", async () => {
    m.verificar.mockRejectedValue(new ErroNegocio("Consulte condições", 409));
    expect((await POST(req())).status).toBe(409);
    expect(m.criar).not.toHaveBeenCalled(); expect(m.assinar).not.toHaveBeenCalled();
  });
  it("envia cliente existente ao serviço para preservar reaproveitamento da pendência", async () => {
    m.buscar.mockResolvedValue({ id: "existente" });
    m.assinar.mockResolvedValue({ assinatura: { id: "a" }, link: "link-existente" });
    expect((await POST(req())).status).toBe(201);
    expect(m.verificar).not.toHaveBeenCalled(); expect(m.criar).not.toHaveBeenCalled();
    expect(m.assinar).toHaveBeenCalledWith(expect.objectContaining({ clienteId: "existente" }));
  });
  it("recusa origem externa antes de cadastrar ou cobrar", async () => {
    const r = req(); r.headers.set("sec-fetch-site", "cross-site");
    expect((await POST(r)).status).toBe(403); expect(m.buscar).not.toHaveBeenCalled(); expect(m.assinar).not.toHaveBeenCalled();
  });
  it("limita o corpo recebido mesmo sem cabeçalho de tamanho", async () => {
    expect((await POST(new Request("http://local/api/assinaturas", { method: "POST", body: JSON.stringify({ lixo: "x".repeat(33_000) }) }))).status).toBe(413);
    expect(m.buscar).not.toHaveBeenCalled(); expect(m.criar).not.toHaveBeenCalled(); expect(m.assinar).not.toHaveBeenCalled();
  });
  it("não mistura cliente por id com substituição silenciosa de dados", async () => {
    const r = new Request("http://local/api/assinaturas", { method: "POST", body: JSON.stringify({ cliente: { id: "existente", telefone: "47999990000", nome: "Outro" }, planoId: "p", forma: "PIX" }) });
    expect((await POST(r)).status).toBe(400); expect(m.assinar).not.toHaveBeenCalled(); expect(m.buscar).not.toHaveBeenCalled();
  });
});
