import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ buscar: vi.fn(), transacao: vi.fn(), travar: vi.fn(), atualizarLink: vi.fn(), atualizarCliente: vi.fn(), criarCliente: vi.fn(), cobrar: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { linkPagamento: { findUnique: m.buscar }, $transaction: m.transacao } }));
vi.mock("@/lib/auditoria", () => ({ auditar: vi.fn() }));
vi.mock("@/lib/agenda/carregar", () => ({ configuracao: async () => ({ nomeBarbearia: "Black sintética", fuso: "America/Sao_Paulo" }) }));
vi.mock("@/lib/links/transacao", () => ({ travarLink: m.travar, INCLUIR_CLIENTE: {}, limparTentativa: {}, encerramentoPendente: () => null }));
vi.mock("@/lib/links/sincronizacao", () => ({ sincronizarLink: vi.fn(), marcarLinkPago: vi.fn() }));
vi.mock("@/lib/links/estado", () => ({ estadoCheckoutLink: () => ({ status: "PENDENTE" }) }));
vi.mock("@/lib/pagamentos/gateway", () => ({ gateway: async () => ({ nome: "pagarme", cartao: "token", exigeEmail: true, criarCliente: m.criarCliente, criarCobrancaAvulsa: m.cobrar }), gatewayPorId: vi.fn() }));
import { pagarLink } from "@/lib/links/checkout";

const cadastro = { nome: "Cliente cadastrado", cpf: "11144477735", email: "cadastro@example.invalid" };
const pagador = { forma: "PIX" as const, cpf: "52998224725", email: "pagador@example.invalid" };
let link: Record<string, unknown>;
beforeEach(() => {
  vi.resetAllMocks();
  link = { id: "link-sintetico", token: "token-sintetico", clienteId: "cliente-A", cliente: { ...cadastro }, nome: cadastro.nome, telefone: "5511999990000", valorCentavos: 6000,
    status: "PENDENTE", gatewayId: null, tentativaChave: null, expiraEm: new Date(Date.now() + 86_400_000), parcelasMax: 1, cpf: null, email: null, comandaId: null, descricao: "Corte sintético" };
  m.buscar.mockImplementation(async () => ({ ...link }));
  m.travar.mockImplementation(async () => ({ ...link }));
  m.atualizarLink.mockImplementation(async ({ data }) => { Object.assign(link, data); return { ...link }; });
  m.atualizarCliente.mockImplementation(async ({ data }) => Object.assign(link.cliente as object, data));
  m.transacao.mockImplementation(async (executar) => executar({ linkPagamento: { update: m.atualizarLink }, cliente: { update: m.atualizarCliente } }));
  m.criarCliente.mockResolvedValue("cus_sintetico");
});
afterEach(() => vi.unstubAllEnvs());

describe("dados do pagador público", () => {
  it("emissão desligada não cria tentativa, não altera cadastro e não consulta o provedor", async () => {
    vi.stubEnv("PAGAMENTOS_COBRANCAS_REAIS_BLOQUEADAS", "true");
    await expect(pagarLink("token-sintetico", pagador)).rejects.toMatchObject({ codigo: "cobrancas_reais_bloqueadas" });
    expect(m.atualizarLink).not.toHaveBeenCalled();
    expect(m.atualizarCliente).not.toHaveBeenCalled();
    expect(m.criarCliente).not.toHaveBeenCalled();
    expect(m.cobrar).not.toHaveBeenCalled();
  });
  it.each([false, true])("não sobrescreve o cadastro global, inclusive quando o retorno é incerto (%s)", async (timeout) => {
    if (timeout) m.cobrar.mockRejectedValue(Error("Resposta perdida"));
    else m.cobrar.mockResolvedValue({ id: "or_sintetico", status: "PENDENTE", valorCentavos: 6000, moeda: "BRL", liquidadoCentavos: 0, pagaEm: null });
    if (timeout) await expect(pagarLink("token-sintetico", pagador)).rejects.toMatchObject({ codigo: "pagamento_incerto" });
    else await pagarLink("token-sintetico", pagador);
    expect(m.atualizarCliente).not.toHaveBeenCalled();
    expect(link.cliente).toEqual(cadastro);
    expect(link).toMatchObject({ cpf: pagador.cpf, email: pagador.email });
    expect(m.criarCliente).toHaveBeenCalledWith(expect.objectContaining({ cpf: pagador.cpf, email: pagador.email, referencia: link.tentativaChave }));
  });
});
