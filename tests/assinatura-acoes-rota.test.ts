import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ cliente: vi.fn(), sessao: vi.fn(), permissao: vi.fn(), buscar: vi.fn(), solicitar: vi.fn(), cancelar: vi.fn(), aplicar: vi.fn(), cancelarPedido: vi.fn(), assinar: vi.fn(), cancelarPlano: vi.fn(), situacao: vi.fn(), fila: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { assinatura: { findFirst: m.buscar, findUnique: m.buscar } } }));
vi.mock("@/lib/auth/sessao", () => ({ exigirCliente: m.cliente, exigirSessao: m.sessao, BALCAO: ["DONO", "GERENTE", "RECEPCAO"] }));
vi.mock("@/lib/auth/permissoes", () => ({ exigirPermissao: m.permissao }));
vi.mock("@/lib/assinaturas/alteracao-plano", () => ({ solicitarAlteracaoPlano: m.solicitar, cancelarAlteracaoPlano: m.cancelarPedido, aplicarAlteracaoPlano: m.aplicar, alteracaoAtual: vi.fn() }));
vi.mock("@/lib/assinaturas/operacao-inicial", () => ({ cancelarOperacaoInicial: m.cancelar }));
vi.mock("@/lib/assinaturas/servico", () => ({ assinar: m.assinar, cancelar: vi.fn(), entrarNaListaDeEspera: m.fila, situacaoDoCliente: m.situacao, vagasRestantes: vi.fn() }));
vi.mock("@/lib/assinaturas/retencao", () => ({ cancelarPeloCliente: m.cancelarPlano, registrarCancelamentoDaEquipe: vi.fn() }));
vi.mock("@/lib/assinaturas/cobrancas", () => ({ cobrancaEmAberto: vi.fn(), cobrarPeloWhatsApp: vi.fn(), linkAbsoluto: vi.fn(), processarEventoGateway: vi.fn(), sincronizarAssinatura: vi.fn() }));
import { PATCH, POST as assinarCliente, DELETE as cancelarCliente } from "@/app/api/cliente/assinatura/route";
import { MOTIVOS_CANCELAMENTO } from "@/lib/assinaturas/schemas";
import { POST } from "@/app/api/assinaturas/[id]/route";
import { proibido } from "@/lib/erros";
const req = (body: unknown, headers: Record<string, string> = {}) => new Request("http://localhost/api/cliente/assinatura", { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
const ctx = { params: Promise.resolve({ id: "assinatura-equipe" }) };
beforeEach(() => {
  vi.resetAllMocks(); m.cliente.mockResolvedValue({ clienteId: "cliente-dono", usuarioId: "u" }); m.sessao.mockResolvedValue({ usuarioId: "equipe", papel: "RECEPCAO" });
  m.buscar.mockResolvedValue({ id: "assinatura-do-cliente" }); m.cancelar.mockResolvedValue({ cancelada: false, emConferencia: true });
  m.cancelarPedido.mockResolvedValue({ cancelada: true });
  m.assinar.mockResolvedValue({ link: "/c/assinar/teste" });
  m.situacao.mockResolvedValue({ assinatura: { id: "assinatura-do-cliente" } });
});

describe("contrato de criação e encerramento pelo cliente", () => {
  const casos = [
    { nome: "adesão", handler: assinarCliente, body: { planoId: "p", forma: "PIX" } },
    { nome: "cancelamento", handler: cancelarCliente, body: { motivo: MOTIVOS_CANCELAMENTO[0] } },
  ];
  it.each(casos)("recusa $nome cross-site antes de executar serviço", async ({ handler, body }) => {
    expect((await handler(req(body, { origin: "https://terceiro.invalid" }))).status).toBe(403);
    expect(m.assinar).not.toHaveBeenCalled(); expect(m.cancelarPlano).not.toHaveBeenCalled(); expect(m.situacao).not.toHaveBeenCalled();
  });
  it.each(casos)("limita $nome sem confiar em Content-Length", async ({ handler, body }) => {
    const grande = req({ ...body, lixo: "x".repeat(33_000) });
    expect(grande.headers.has("content-length")).toBe(false);
    expect((await handler(grande)).status).toBe(413);
    expect(m.assinar).not.toHaveBeenCalled(); expect(m.cancelarPlano).not.toHaveBeenCalled();
  });
  it.each(casos)("recusa campos privilegiados em $nome", async ({ handler, body }) => {
    expect((await handler(req({ ...body, clienteId: "outro", usuarioId: "outro" }))).status).toBe(400);
    expect(m.assinar).not.toHaveBeenCalled(); expect(m.cancelarPlano).not.toHaveBeenCalled();
  });
  it("envia identidade e versão exclusivamente da sessão para a adesão", async () => {
    m.cliente.mockResolvedValue({ clienteId: "cliente-dono", usuarioId: "u", sessaoVersao: 7 });
    expect((await assinarCliente(req({ planoId: "p", forma: "PIX" }))).status).toBe(201);
    expect(m.assinar).toHaveBeenCalledWith(expect.objectContaining({ clienteId: "cliente-dono", usuarioId: "u", titular: { usuarioId: "u", sessaoVersao: 7 } }));
  });
  it("mantém cancelamento associado à assinatura da sessão", async () => {
    expect((await cancelarCliente(req({ motivo: MOTIVOS_CANCELAMENTO[0] }))).status).toBe(200);
    expect(m.situacao).toHaveBeenCalledWith("cliente-dono");
    expect(m.cancelarPlano).toHaveBeenCalledWith(expect.objectContaining({ assinaturaId: "assinatura-do-cliente", usuarioId: "u" }));
  });
});
describe("ações de assinatura autenticadas", () => {
  it("busca a assinatura do cliente da sessão e nunca aceita um id escolhido no corpo", async () => {
    expect((await PATCH(req({ acao: "solicitar_troca", planoId: "novo" }))).status).toBe(201);
    expect(m.buscar).toHaveBeenCalledWith(expect.objectContaining({ where: { clienteId: "cliente-dono", status: { not: "CANCELADA" } } }));
    expect(m.solicitar).toHaveBeenCalledWith({ assinaturaId: "assinatura-do-cliente", planoId: "novo", origem: "SITE", usuarioId: "u" });
    expect((await PATCH(req({ acao: "cancelar_operacao", assinaturaId: "outra" }))).status).toBe(400);
    expect(m.cancelar).not.toHaveBeenCalled();
  });
  it("recusa origem externa antes de tocar na assinatura", async () => {
    expect((await PATCH(req({ acao: "cancelar_operacao" }, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect(m.buscar).not.toHaveBeenCalled(); expect(m.cancelar).not.toHaveBeenCalled();
  });
  it("recusa corpo acima do limite", async () => {
    expect((await PATCH(req({ acao: "cancelar_operacao" }, { "content-length": "40000" }))).status).toBe(413);
    expect(m.buscar).not.toHaveBeenCalled();
  });
  it("cliente não aplica a troca nem cancela assinatura de outro cliente", async () => {
    expect((await PATCH(req({ acao: "aplicar_troca" }))).status).toBe(400);
    m.buscar.mockResolvedValue(null);
    expect((await PATCH(req({ acao: "cancelar_operacao" }))).status).toBe(404);
    expect(m.aplicar).not.toHaveBeenCalled(); expect(m.cancelar).not.toHaveBeenCalled();
  });
  it.each(["aplicar_troca", "cancelar"])("recepção sem permissão não executa %s em plano pago", async acao => {
    m.permissao.mockRejectedValue(proibido());
    expect((await POST(req({ acao, planoId: "novo", motivo: "Solicitado pelo cliente" }), ctx)).status).toBe(403);
    expect(m.solicitar).not.toHaveBeenCalled(); expect(m.aplicar).not.toHaveBeenCalled(); expect(m.cancelar).not.toHaveBeenCalled(); expect(m.cancelarPedido).not.toHaveBeenCalled();
  });
  it.each(["solicitar_troca", "cancelar_troca", "cancelar_operacao"])("recepção pode %s sem ganhar permissão para encerrar plano pago", async acao => {
    m.permissao.mockRejectedValue(proibido());
    expect((await POST(req({ acao, planoId: "novo" }), ctx)).status).toBe(acao === "solicitar_troca" ? 201 : 200);
    expect(m.sessao).toHaveBeenCalledWith(["DONO", "GERENTE", "RECEPCAO"]);
    expect(m.permissao).not.toHaveBeenCalled(); expect(m.aplicar).not.toHaveBeenCalled();
  });
  it("usuário fora do balcão não consegue cancelar a operação inicial", async () => {
    m.sessao.mockRejectedValue(proibido());
    expect((await POST(req({ acao: "cancelar_operacao" }), ctx)).status).toBe(403);
    expect(m.buscar).not.toHaveBeenCalled(); expect(m.cancelar).not.toHaveBeenCalled();
  });
  it("equipe autorizada registra a origem e o responsável", async () => {
    expect((await POST(req({ acao: "solicitar_troca", planoId: "novo" }), ctx)).status).toBe(201);
    expect(m.solicitar).toHaveBeenCalledWith({ assinaturaId: "assinatura-equipe", planoId: "novo", origem: "RECEPCAO", usuarioId: "equipe" });
  });
});
