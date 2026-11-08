import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ fatura: vi.fn(), duplicadas: vi.fn(), consultar: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { cobranca: { findFirst: m.fatura, count: m.duplicadas }, configuracao: { findUnique: vi.fn().mockResolvedValue({ fuso: "America/Sao_Paulo" }) } } }));
vi.mock("@/lib/pagamentos/gateway", () => ({ gatewayPorId: vi.fn().mockResolvedValue({ buscarCobranca: m.consultar }) }));
vi.mock("@/lib/assinaturas/cobrancas", () => ({ linkAbsoluto: (link: string) => `https://black.example.invalid${link}` }));
import { linkDaMensalidadeParaAtendimento } from "@/lib/assinaturas/link-atendimento";

const atual = () => ({
  id: "cob1", assinaturaId: "a1", gatewayId: "ch_1", status: "PENDENTE", forma: "BOLETO", pagaEm: null,
  link: "/c/pagar/token", tokenPublico: "token", valorCentavos: 9900, vencimento: new Date("2026-11-10T00:00:00Z"), expiraEm: null,
  vinculosExternos: [], assinatura: { gatewayId: "sub_1", clienteId: "cliente1", formaPagamento: "BOLETO", status: "ATIVA", operacaoInicial: null, pausadaEm: null, encerraEm: null, cliente: { telefone: "5547999990000", excluidoEm: null } },
});
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-08T15:00:00Z"));
  m.fatura.mockResolvedValue(atual()); m.duplicadas.mockResolvedValue(1);
  m.consultar.mockResolvedValue({ id: "ch_1", assinaturaGatewayId: "sub_1", valorCentavos: 9900, vencimento: "2026-11-10", vencimentoConfirmado: true, abertaConfirmada: true, forma: "BOLETO", status: "PENDENTE", pagaEm: null, link: null });
});
afterEach(() => vi.useRealTimers());

describe("link da mensalidade solicitado no atendimento", () => {
  it("devolve o boleto existente, após consulta ao gateway e revalidação local", async () => {
    expect(await linkDaMensalidadeParaAtendimento("cliente1", "cob1")).toMatchObject({ link: "https://black.example.invalid/c/pagar/token", em_conferencia: false });
    expect(m.consultar).toHaveBeenCalledOnce();
    expect(m.fatura).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "cob1", assinatura: { clienteId: "cliente1" } } }));
  });
  it("não oferece pagamento quando o gateway já liquidou", async () => {
    m.consultar.mockResolvedValue({ status: "PAGA", pagaEm: "2026-11-08" });
    expect(await linkDaMensalidadeParaAtendimento("cliente1", "cob1")).toMatchObject({ link: null, em_conferencia: true });
  });
  it("suprime o link se um webhook pagar a fatura durante a consulta", async () => {
    m.fatura.mockResolvedValueOnce(atual()).mockResolvedValueOnce({ ...atual(), status: "PAGA", pagaEm: new Date() });
    expect(await linkDaMensalidadeParaAtendimento("cliente1", "cob1")).toMatchObject({ link: null, em_conferencia: true });
  });
  it("fatura duplicada exige conferência", async () => {
    m.duplicadas.mockResolvedValue(2);
    expect(await linkDaMensalidadeParaAtendimento("cliente1", "cob1")).toMatchObject({ link: null, em_conferencia: true });
  });
  it.each(["cartao", "boleto_vencido", "estorno", "operacao_inicial", "historico"])("não sugere novo pagamento em %s", async caso => {
    const c = atual();
    if (caso === "cartao") c.assinatura.formaPagamento = "CARTAO";
    if (caso === "boleto_vencido") c.vencimento = new Date("2026-11-07T00:00:00Z");
    if (caso === "estorno") c.status = "ESTORNADA";
    if (caso === "operacao_inicial") Object.assign(c.assinatura, { operacaoInicial: "CRIANDO" });
    if (caso === "historico") Object.assign(c, { vinculosExternos: [{ id: "legado" }] });
    m.fatura.mockResolvedValue(c);
    expect(await linkDaMensalidadeParaAtendimento("cliente1", "cob1")).toMatchObject({ link: null, em_conferencia: true });
    expect(m.consultar).not.toHaveBeenCalled();
  });
  it("falha de consulta não cria outro boleto ou assinatura", async () => {
    m.consultar.mockRejectedValue(new Error("indisponível"));
    expect(await linkDaMensalidadeParaAtendimento("cliente1", "cob1")).toMatchObject({ link: null, em_conferencia: true });
  });
});
