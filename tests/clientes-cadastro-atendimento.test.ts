import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  sessao: vi.fn(), atual: vi.fn(), ler: vi.fn(), atualizar: vi.fn(), audit: vi.fn(), lock: vi.fn(), linha: vi.fn(),
  agenda: vi.fn(), total: vi.fn(), situacao: vi.fn(),
}));
vi.mock("@/lib/auth/sessao", () => ({ exigirSessao: m.sessao }));
vi.mock("@/lib/auditoria", () => ({ auditar: m.audit }));
vi.mock("@/lib/assinaturas/servico", () => ({ situacaoDoCliente: m.situacao }));
vi.mock("@/lib/db", () => ({ db: {
  cliente: { findFirst: m.ler }, agendamento: { findMany: m.agenda, count: m.total },
  $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({ $executeRaw: m.lock, $queryRaw: m.linha,
    cliente: { findUnique: m.atual, update: m.atualizar } }),
} }));
import { atualizarCadastroAtendimento } from "@/lib/clientes/cadastro-atendimento";
import { GET, PATCH } from "@/app/api/clientes/[id]/route";
import { ErroNegocio } from "@/lib/erros";

const cliente = { id: "fixture-cliente", nome: "Teste sintético", excluidoEm: null,
  observacoes: null, dataNascimento: null, origem: null, origemDetalhe: null, criadoEm: new Date("2026-01-01") };
const contexto = { params: Promise.resolve({ id: cliente.id }) };
function pedido(corpo: unknown, origem = "http://localhost:3015") {
  return new Request(`http://localhost:3015/api/clientes/${cliente.id}`, {
    method: "PATCH", headers: { origin: origem, "content-type": "application/json" }, body: JSON.stringify(corpo),
  });
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("PAINEL_URL", "http://localhost:3015");
  m.lock.mockResolvedValue(1); m.linha.mockResolvedValue([{ id: cliente.id }]);
  m.sessao.mockResolvedValue({ usuarioId: "equipe-teste", papel: "RECEPCAO" });
  m.atual.mockResolvedValue(cliente); m.ler.mockResolvedValue(cliente);
  m.atualizar.mockImplementation(async ({ data }) => ({ dataNascimento: null, origem: null, origemDetalhe: null, observacoes: null, ...data }));
  m.agenda.mockResolvedValue([]); m.total.mockResolvedValue(0); m.situacao.mockResolvedValue(null);
});

describe("ficha legada respeita exclusão do cliente", () => {
  it("recusa mutação após exclusão sem gravar campos nem auditoria", async () => {
    m.atual.mockResolvedValue({ ...cliente, excluidoEm: new Date() });
    const r = await PATCH(pedido({ dataNascimento: "1990-01-10", origem: "INDICACAO", origemDetalhe: "Pessoa de teste", observacoes: "Texto de teste" }), contexto);
    expect(r.status).toBe(404); expect(m.atualizar).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
  });
  it("revalida depois de aguardar a exclusão, antes de ler ou atualizar dados pessoais", async () => {
    const entrou = Promise.withResolvers<void>(), liberar = Promise.withResolvers<void>();
    m.lock.mockImplementationOnce(async () => { entrou.resolve(); await liberar.promise; });
    const alteracao = atualizarCadastroAtendimento(cliente.id, { observacoes: "Não pode voltar" }, "equipe-teste");
    const rejeicao = expect(alteracao).rejects.toMatchObject({ status: 404 });
    await entrou.promise;
    expect(m.atual).not.toHaveBeenCalled();
    m.atual.mockResolvedValue({ ...cliente, excluidoEm: new Date() }); liberar.resolve();
    await rejeicao;
    expect(m.lock.mock.calls[0][1]).toBe(`cliente-ciclo:${cliente.id}`);
    expect(m.atualizar).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
  });
  it("preserva formato da resposta e registra somente nomes de campos na auditoria", async () => {
    const r = await PATCH(pedido({ dataNascimento: "1990-01-10", origem: "INDICACAO", origemDetalhe: "Pessoa de teste" }), contexto);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ dataNascimento: "1990-01-10", origem: "INDICACAO", origemDetalhe: "Pessoa de teste", observacoes: null });
    expect(m.linha).toHaveBeenCalledOnce();
    expect(m.audit.mock.calls[0][5]).toEqual({ origem: "cadastro_atendimento", campos: ["dataNascimento", "origem", "origemDetalhe"] });
    expect(JSON.stringify(m.audit.mock.calls[0][5])).not.toContain("Pessoa de teste");
  });
  it("GET oculta cadastro excluído e não consulta seu histórico", async () => {
    m.ler.mockResolvedValue(null);
    expect((await GET(new Request("http://localhost:3015"), contexto)).status).toBe(404);
    expect(m.ler).toHaveBeenCalledWith(expect.objectContaining({ where: { id: cliente.id, excluidoEm: null } }));
    expect(m.agenda).not.toHaveBeenCalled(); expect(m.situacao).not.toHaveBeenCalled();
  });
  it("mantém resumo privado para cadastro ativo", async () => {
    const r = await GET(new Request("http://localhost:3015"), contexto);
    expect(r.status).toBe(200); expect(r.headers.get("cache-control")).toBe("private, no-store");
  });
  it("não permite cliente sem acesso de equipe nem origem externa", async () => {
    m.sessao.mockRejectedValueOnce(new ErroNegocio("Sem acesso", 403));
    expect((await PATCH(pedido({ observacoes: "Teste" }), contexto)).status).toBe(403);
    expect((await PATCH(pedido({ observacoes: "Teste" }, "https://externo.invalid"), contexto)).status).toBe(403);
    expect(m.lock).not.toHaveBeenCalled();
  });
  it("mantém validação estrita e corpo limitado antes da transação", async () => {
    expect((await PATCH(pedido({ nome: "Não permitido" }), contexto)).status).toBe(400);
    expect((await PATCH(pedido({ observacoes: "x".repeat(32769) }), contexto)).status).toBe(413);
    expect(m.lock).not.toHaveBeenCalled();
  });
});
