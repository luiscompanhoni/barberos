import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  cliente: vi.fn(), clienteTx: vi.fn(), usuario: vi.fn(), criarGateway: vi.fn(), plano: vi.fn(), assinaturaAtual: vi.fn(), tx: vi.fn(), planoTx: vi.fn(), lock: vi.fn(),
  criar: vi.fn(), concorrente: vi.fn(), atualizarCliente: vi.fn(), filaUpsert: vi.fn(), filaCount: vi.fn(), gateway: vi.fn(), cobranca: vi.fn(), emissao: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  cliente: { findUnique: m.cliente }, plano: { findUnique: m.plano }, assinatura: { findFirst: m.assinaturaAtual },
  emissaoPixMensal: { findFirst: m.emissao },
  $transaction: (fn: (tx: unknown) => unknown) => m.tx(fn),
} }));
vi.mock("@/lib/agenda/carregar", () => ({ configuracao: vi.fn().mockResolvedValue({ fuso: "America/Sao_Paulo", toleranciaAtrasoDias: 1 }), servicoDoBarbeiro: vi.fn() }));
vi.mock("@/lib/pagamentos/gateway", () => ({ gateway: m.gateway, gatewayPorId: vi.fn(), provedorPorId: vi.fn() }));
vi.mock("@/lib/assinaturas/cobrancas", () => ({ cobrancaEmAberto: m.cobranca, linkAbsoluto: (x: string | null) => x, novoTokenPublico: () => "token", sincronizarAssinatura: vi.fn() }));
vi.mock("@/lib/whatsapp/conversas", () => ({ notificarEmSegundoPlano: vi.fn() }));
import { assinar, entrarNaListaDeEspera } from "@/lib/assinaturas/servico";
import { schemaPlano } from "@/lib/assinaturas/schemas";

const plano = { id: "p", nome: "Business", ativo: true, visivel: true, compravel: false, precoCentavos: 10000, formasPagamento: ["PIX"], vagas: null };
const dados = { clienteId: "c", planoId: "p", forma: "PIX" as const, origem: "SITE" as const };
beforeEach(() => {
  vi.clearAllMocks();
  const cliente = { id: "c", nome: "Cliente", cpf: "52998224725", email: "", telefone: "5547999990000", excluidoEm: null, usuarioId: "u" };
  m.cliente.mockResolvedValue(cliente); m.clienteTx.mockResolvedValue(cliente);
  m.usuario.mockResolvedValue({ id: "u", ativo: true, papel: "CLIENTE", sessaoVersao: 2 });
  m.plano.mockResolvedValue(plano); m.planoTx.mockResolvedValue(plano); m.assinaturaAtual.mockResolvedValue(null);
  m.cobranca.mockResolvedValue(null); m.emissao.mockResolvedValue(null); m.gateway.mockResolvedValue({ exigeEmail: false, criarCliente: m.criarGateway });
  m.tx.mockImplementation((fn: (tx: unknown) => unknown) => fn({ $queryRaw: m.lock, $executeRaw: m.lock, plano: { findUnique: m.planoTx },
    assinatura: { create: m.criar, findFirst: m.concorrente, count: vi.fn().mockResolvedValue(0) }, cliente: { findUnique: m.clienteTx, findUniqueOrThrow: m.clienteTx, update: m.atualizarCliente }, usuario: { findUnique: m.usuario }, listaEsperaPlano: { upsert: m.filaUpsert, count: m.filaCount } }));
  m.concorrente.mockResolvedValue(null);
});

describe("planos visíveis para consulta", () => {
  it.each(["SITE", "BOT", "RECEPCAO"] as const)("bloqueia nova assinatura na origem %s antes de gateway ou registro", async origem => {
    await expect(assinar({ ...dados, origem })).rejects.toMatchObject({ status: 409 });
    expect(m.gateway).not.toHaveBeenCalled(); expect(m.criar).not.toHaveBeenCalled();
  });
  it("bloqueia compra direta de plano oculto no site", async () => {
    m.plano.mockResolvedValue({ ...plano, visivel: false, compravel: true });
    await expect(assinar(dados)).rejects.toMatchObject({ status: 404 });
    expect(m.gateway).not.toHaveBeenCalled(); expect(m.criar).not.toHaveBeenCalled();
  });
  it("recusa lista de espera e não cria registro para plano somente consulta", async () => {
    await expect(entrarNaListaDeEspera("c", "p")).rejects.toMatchObject({ status: 409 });
    expect(m.filaUpsert).not.toHaveBeenCalled(); expect(m.filaCount).not.toHaveBeenCalled();
  });
  it("recusa lista de espera para plano oculto", async () => {
    m.planoTx.mockResolvedValue({ ...plano, visivel: false, compravel: true });
    await expect(entrarNaListaDeEspera("c", "p")).rejects.toMatchObject({ status: 404 });
    expect(m.filaUpsert).not.toHaveBeenCalled();
  });
  it("preserva assinatura pendente anterior e seu link", async () => {
    m.assinaturaAtual.mockResolvedValue({ id: "a", status: "PENDENTE", planoId: "p", plano, formaPagamento: "PIX", tokenPublico: "existente", pausadaEm: null, pausadaAte: null });
    // A consulta de situação também procura cobrança em atraso.
    const db = await import("@/lib/db");
    (db.db as unknown as { cobranca: unknown }).cobranca = { findFirst: vi.fn().mockResolvedValue(null) };
    const r = await assinar(dados);
    expect(r).toMatchObject({ reaproveitada: true, link: "/c/assinar/existente" });
    expect(m.gateway).not.toHaveBeenCalled(); expect(m.criar).not.toHaveBeenCalled();
  });
  it("não reaproveita checkout enquanto emissão Pix está incerta", async () => {
    m.assinaturaAtual.mockResolvedValue({ id: "a", status: "PENDENTE", planoId: "p", plano, formaPagamento: "PIX", tokenPublico: "existente", pausadaEm: null, pausadaAte: null });
    const db = await import("@/lib/db");
    (db.db as unknown as { cobranca: unknown }).cobranca = { findFirst: vi.fn().mockResolvedValue(null) };
    m.emissao.mockResolvedValue({ id: "incerta" });
    await expect(assinar(dados)).rejects.toMatchObject({ status: 409, codigo: "pix_revisao" });
    expect(m.gateway).not.toHaveBeenCalled();
  });
  it("não cancela nem substitui pendência ao tentar escolher outro plano", async () => {
    m.assinaturaAtual.mockResolvedValue({ id: "a", status: "PENDENTE", planoId: "outro", plano: { ...plano, id: "outro" }, formaPagamento: "PIX", tokenPublico: "existente", pausadaEm: null, pausadaAte: null });
    const db = await import("@/lib/db");
    (db.db as unknown as { cobranca: unknown }).cobranca = { findFirst: vi.fn().mockResolvedValue(null) };
    await expect(assinar(dados)).rejects.toMatchObject({ status: 409, codigo: "assinatura_pendente" });
    expect(m.gateway).not.toHaveBeenCalled(); expect(m.criar).not.toHaveBeenCalled(); expect(m.tx).not.toHaveBeenCalled();
  });
  it("revalida permissão sob bloqueio antes de gravar nova adesão", async () => {
    m.plano.mockResolvedValue({ ...plano, compravel: true });
    m.planoTx.mockResolvedValue({ ...plano, compravel: false });
    await expect(assinar(dados)).rejects.toMatchObject({ status: 409 });
    expect(m.lock).toHaveBeenCalled(); expect(m.criar).not.toHaveBeenCalled(); expect(m.atualizarCliente).not.toHaveBeenCalled();
  });
  it("recusa adesão criada por outra requisição antes de registrar ou chamar gateway", async () => {
    m.plano.mockResolvedValue({ ...plano, compravel: true });
    m.planoTx.mockResolvedValue({ ...plano, compravel: true });
    m.concorrente.mockResolvedValue({ id: "outra" });
    await expect(assinar(dados)).rejects.toMatchObject({ status: 409, codigo: "assinatura_existente" });
    expect(m.criar).not.toHaveBeenCalled(); expect(m.atualizarCliente).not.toHaveBeenCalled();
  });
  it("valida a quantidade e a repetição de etiquetas", () => {
    const base = { nome: "Plano", precoCentavos: 10000, servicos: [{ servicoId: "s", usosPorCiclo: 1 }] };
    expect(schemaPlano.safeParse({ ...base, etiquetas: ["Preferido", "preferido"] }).success).toBe(false);
    expect(schemaPlano.safeParse({ ...base, etiquetas: ["1", "2", "3", "4"] }).success).toBe(false);
    expect(schemaPlano.safeParse({ ...base, etiquetas: ["Preferido da galera"] }).success).toBe(true);
  });
  it.each([true, false])("recusa cadastro excluído durante a adesão; titular=%s", async autenticado => {
    m.plano.mockResolvedValue({ ...plano, compravel: true });
    m.clienteTx.mockResolvedValue({ id: "c", nome: "Cliente excluído", excluidoEm: new Date(), cpf: null, email: null });
    await expect(assinar({ ...dados, cpf: "52998224725", email: "qa@example.invalid", ...(autenticado ? { titular: { usuarioId: "u", sessaoVersao: 2 } } : {}) })).rejects.toMatchObject({ status: autenticado ? 401 : 404 });
    expect(m.criarGateway).not.toHaveBeenCalled(); expect(m.criar).not.toHaveBeenCalled(); expect(m.atualizarCliente).not.toHaveBeenCalled();
  });
  it.each([{ sessaoVersao: 3 }, { ativo: false }, { papel: "RECEPCAO" }, { id: "outro" }])("revalida titular sob trava antes de adesão %j", async alteracao => {
    m.plano.mockResolvedValue({ ...plano, compravel: true });
    m.usuario.mockResolvedValue({ id: "u", ativo: true, papel: "CLIENTE", sessaoVersao: 2, ...alteracao });
    await expect(assinar({ ...dados, titular: { usuarioId: "u", sessaoVersao: 2 } })).rejects.toMatchObject({ status: 401, codigo: "sessao_invalida" });
    expect(m.criarGateway).not.toHaveBeenCalled(); expect(m.criar).not.toHaveBeenCalled(); expect(m.atualizarCliente).not.toHaveBeenCalled();
  });
  it("valida os dados atuais, sem restaurar CPF lido antes da trava", async () => {
    m.plano.mockResolvedValue({ ...plano, compravel: true });
    m.clienteTx.mockResolvedValue({ id: "c", nome: "Cliente", cpf: null, email: "novo@example.invalid", telefone: "5547999990000", excluidoEm: null });
    await expect(assinar(dados)).rejects.toMatchObject({ status: 422, codigo: "cpf" });
    expect(m.criarGateway).not.toHaveBeenCalled(); expect(m.atualizarCliente).not.toHaveBeenCalled(); expect(m.criar).not.toHaveBeenCalled();
  });
});
