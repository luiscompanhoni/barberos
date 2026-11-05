import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ sessao: vi.fn(), encerrar: vi.fn(), usuario: vi.fn(), cliente: vi.fn(), remover: vi.fn(), alterar: vi.fn(), audit: vi.fn(), trava: vi.fn(), agendaTx: vi.fn() }));
vi.mock("@/lib/auth/sessao", () => ({ exigirCliente: m.sessao, encerrarSessao: m.encerrar }));
vi.mock("@/lib/auditoria", () => ({ auditar: m.audit }));
vi.mock("@/lib/db", () => {
  const tabela = { count: async () => 0, deleteMany: m.remover, updateMany: m.alterar, update: m.alterar };
  const db = { $executeRaw: m.trava, $queryRaw: vi.fn(), usuario: { findUnique: m.usuario, update: m.alterar },
    cliente: { findUnique: m.cliente, update: m.alterar }, assinatura: tabela, cobranca: tabela,
    pagamentoAntecipado: tabela, linkPagamento: tabela, comanda: tabela, agendamento: tabela, conversa: tabela,
    codigoLogin: tabela, esperaHorario: tabela, listaEsperaPlano: tabela, avaliacaoMensalElegibilidade: tabela,
    pedidoAgendamento: tabela, identidadeSocial: tabela, fluxoSocial: tabela,
  };
  return { db: { ...db, $transaction: (cb: (tx: typeof db) => unknown) => cb({ ...db, agendamento: { ...tabela, count: m.agendaTx } }) } };
});
import { POST } from "@/app/api/cliente/privacidade/route";
import { excluirConta } from "@/lib/lgpd/titular";

const cliente = { id: "cliente", usuarioId: "usuario", telefone: "5511999990000", excluidoEm: null };
const usuario = { id: "usuario", ativo: true, papel: "CLIENTE", sessaoVersao: 3 };
const req = (body: unknown, origin = "https://cliente.example.test") => new Request("https://cliente.example.test/api/cliente/privacidade", {
  method: "POST", headers: { origin }, body: JSON.stringify(body),
});
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("SITE_URL", "https://cliente.example.test");
  m.cliente.mockResolvedValue(cliente); m.usuario.mockResolvedValue(usuario);
  m.agendaTx.mockResolvedValue(0);
  m.sessao.mockResolvedValue({ usuarioId: "usuario", clienteId: "cliente", sessaoVersao: 3 });
});
afterEach(() => vi.unstubAllEnvs());

describe("exclusão revalida a sessão antes de apagar", () => {
  it("recuperação posterior à autenticação invalida requisição antiga sem remover dados", async () => {
    m.usuario.mockResolvedValue({ ...usuario, sessaoVersao: 4 });
    const r = await POST(req({ acao: "excluir", confirmacao: "EXCLUIR" }));
    expect(r.status).toBe(401); expect(await r.json()).toMatchObject({ codigo: "sessao_invalida" });
    expect(m.remover).not.toHaveBeenCalled(); expect(m.alterar).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled(); expect(m.encerrar).not.toHaveBeenCalled();
  });
  it("a rota encaminha a versão atual e permite a exclusão autorizada", async () => {
    const r = await POST(req({ acao: "excluir", confirmacao: "EXCLUIR" }));
    expect(r.status).toBe(200); expect(await r.json()).toEqual({ excluida: true });
    expect(m.remover).toHaveBeenCalled(); expect(m.encerrar).toHaveBeenCalledTimes(1);
    expect(m.alterar).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "usuario" }, data: expect.objectContaining({ ativo: false, sessaoVersao: { increment: 1 } }) }));
  });
  it("chamada legada sem versão não equivale à versão recém-revogada", async () => {
    await expect(excluirConta("cliente", "usuario")).rejects.toMatchObject({ status: 401 });
    expect(m.remover).not.toHaveBeenCalled(); expect(m.alterar).not.toHaveBeenCalled();
  });
  it("reserva surgida após a pré-checagem bloqueia exclusão dentro da transação", async () => {
    m.agendaTx.mockResolvedValue(1);
    const r = await POST(req({ acao: "excluir", confirmacao: "EXCLUIR" }));
    expect(r.status).toBe(409); expect(await r.json()).toMatchObject({ codigo: "exclusao_bloqueada" });
    expect(m.remover).not.toHaveBeenCalled(); expect(m.alterar).not.toHaveBeenCalled(); expect(m.encerrar).not.toHaveBeenCalled();
  });
  it("origem externa, corpo excessivo e confirmação incorreta não apagam dados", async () => {
    expect((await POST(req({ acao: "excluir", confirmacao: "EXCLUIR" }, "https://externo.example.test"))).status).toBe(403);
    expect((await POST(req({ acao: "excluir", confirmacao: "X".repeat(32769) }))).status).toBe(413);
    expect((await POST(req({ acao: "excluir", confirmacao: "talvez" }))).status).toBe(422);
    expect(m.remover).not.toHaveBeenCalled(); expect(m.alterar).not.toHaveBeenCalled(); expect(m.encerrar).not.toHaveBeenCalled();
  });
});
