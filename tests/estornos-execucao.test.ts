import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PedidoEstorno } from "@prisma/client";
import type { Sessao } from "@/lib/auth/sessao";

const m = vi.hoisted(() => ({
  pedido: null as PedidoEstorno | null,
  pagamento: { id: "pg1", valorCentavos: 5000, estornadoCentavos: 0, status: "PAGO" },
  estornar: vi.fn(), caixa: vi.fn(), auditar: vi.fn(), duplicado: false, donoAtivo: true,
  falharConclusao: false, jaDevolvido: 0, efeitosLink: vi.fn(), consultas: vi.fn(),
}));
vi.mock("@/lib/db", () => {
  const tx = {
    $queryRaw: m.consultas, $executeRaw: m.consultas,
    usuario: { findUnique: async () => ({ ativo: m.donoAtivo, papel: "DONO" }) },
    pedidoEstorno: {
      findUniqueOrThrow: async () => structuredClone(m.pedido),
      findUnique: async () => structuredClone(m.pedido),
      aggregate: async () => ({ _sum: { valorCentavos: m.jaDevolvido } }),
      findFirst: async () => m.duplicado ? { id: "outro-estorno" } : null,
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<PedidoEstorno> }) => {
        if (data.status === "EXECUTADO" && m.falharConclusao) { m.falharConclusao = false; throw Error("Falhou registro depois do efeito"); }
        const atual = m.pedido!;
        const corresponde = Object.entries(where).every(([k, v]) => typeof v === "object" && v !== null && "in" in v
          ? (v.in as unknown[]).includes(atual[k as keyof PedidoEstorno]) : atual[k as keyof PedidoEstorno] === v);
        if (!corresponde) return { count: 0 };
        Object.assign(atual, data); return { count: 1 };
      },
    },
    pagamentoComanda: { findUniqueOrThrow: async () => ({ ...m.pagamento }), update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(m.pagamento, data) },
    linkPagamento: { update: m.efeitosLink },
    cobrancaSimulada: { updateMany: async () => ({ count: 1 }) },
  };
  return { db: { ...tx, $transaction: async (fn: (t: typeof tx) => unknown) => {
    const antes = structuredClone(m.pedido); const pg = { ...m.pagamento };
    try { return await fn(tx); } catch (e) { m.pedido = antes; Object.assign(m.pagamento, pg); throw e; }
  } } };
});
vi.mock("@/lib/estornos/alvo", () => ({ carregarAlvo: async () => ({
  comandaId: "cmd1", pagamentoComandaId: "pg1", gatewayId: "or_online", valorOriginal: 5000, bloqueio: null,
}) }));
vi.mock("@/lib/auditoria", () => ({ auditar: m.auditar }));
vi.mock("@/lib/eventos", () => ({ publicar: vi.fn() }));
vi.mock("@/lib/pagamentos/pagarme", () => ({ estornarCobranca: m.estornar }));
vi.mock("@/lib/financeiro/caixa", () => ({ movimentarCaixa: m.caixa, caixaAberto: async () => null }));
vi.mock("@/lib/auth/permissoes", () => ({ pode: async () => true, telefonesCom: async () => [] }));
vi.mock("@/lib/whatsapp/conversas", () => ({ notificarCliente: vi.fn() }));
import { executarEstorno, registrarManual } from "@/lib/estornos/executar";
import { decidirEstorno } from "@/lib/estornos/servico";

const dono = { usuarioId: "dono", papel: "DONO" } as Sessao;
beforeEach(() => {
  vi.stubEnv("AMBIENTE", "local");
  vi.resetAllMocks(); m.duplicado = false; m.donoAtivo = true; m.falharConclusao = false; m.jaDevolvido = 0;
  Object.assign(m.pagamento, { id: "pg1", valorCentavos: 5000, estornadoCentavos: 0, status: "PAGO" });
  m.pedido = { id: "est1", tipo: "LINK", referenciaId: "link1", valorCentavos: 5000, valorOriginalCentavos: 5000,
    motivo: "Devolução solicitada", status: "APROVADO", meio: "PAGARME", forma: "ONLINE", descricao: "Link sintético", comandaId: "cmd1",
    clienteNome: "Cliente sintético", pedidoPorId: "dono", decididoPorId: "dono", motivoDecisao: "Aprovado",
    gatewayEstornoId: null, instrucao: null, erro: null, movimentoCaixaId: null,
    criadoEm: new Date(), decididoEm: new Date(), executadoEm: null, atualizadoEm: new Date() };
  m.estornar.mockResolvedValue({ status: "refunded", pendente: false, estornoId: "tran_refund" });
  m.caixa.mockResolvedValue({ id: "sangria1" });
});
afterEach(() => vi.unstubAllEnvs());

describe("estornos: intenção, prova e ausência de repetição financeira", () => {
  it("homologação recusa estorno online real antes de reservar intenção ou chamar provedor", async () => {
    vi.stubEnv("AMBIENTE", "homologacao");
    await expect(executarEstorno(dono, "est1")).rejects.toMatchObject({ codigo: "homologacao" });
    expect(m.pedido?.instrucao).toBeNull(); expect(m.estornar).not.toHaveBeenCalled(); expect(m.auditar).not.toHaveBeenCalled();
  });
  it("persiste intenção antes do HTTP e chamada simultânea só executa uma vez", async () => {
    let terminar!: (r: unknown) => void;
    m.estornar.mockImplementationOnce(() => {
      expect(m.pedido).toMatchObject({ status: "APROVADO", instrucao: expect.any(String) });
      return new Promise(resolve => { terminar = resolve; });
    });
    const primeira = executarEstorno(dono, "est1");
    await vi.waitFor(() => expect(m.estornar).toHaveBeenCalledOnce());
    await executarEstorno(dono, "est1");
    terminar({ status: "refunded", pendente: false, estornoId: "tran_refund" }); await primeira;
    expect(m.estornar).toHaveBeenCalledOnce(); expect(m.pedido?.status).toBe("EXECUTADO");
    expect(m.pagamento.estornadoCentavos).toBe(5000);
  });
  it("timeout após efeito mantém reserva e nunca reenvia nem baixa sem prova", async () => {
    let efeitosExternos = 0;
    m.estornar.mockImplementationOnce(async () => { efeitosExternos++; throw new TypeError("Resposta perdida depois da devolução"); });
    await executarEstorno(dono, "est1"); await executarEstorno(dono, "est1");
    expect(efeitosExternos).toBe(1); expect(m.estornar).toHaveBeenCalledOnce();
    expect(m.pedido).toMatchObject({ status: "APROVADO", executadoEm: null, instrucao: expect.any(String) });
    expect(m.pagamento.estornadoCentavos).toBe(0); expect(m.efeitosLink).not.toHaveBeenCalled();
  });
  it.each(["pending_refund", "processing", "paid", "desconhecido"])("retorno %s não altera financeiro", async status => {
    m.estornar.mockResolvedValue({ status, pendente: status === "pending_refund" || status === "processing", estornoId: "tran_pending" });
    await executarEstorno(dono, "est1"); await executarEstorno(dono, "est1");
    expect(m.pedido).toMatchObject({ status: "APROVADO", gatewayEstornoId: "tran_pending", executadoEm: null });
    expect(m.pagamento.estornadoCentavos).toBe(0); expect(m.efeitosLink).not.toHaveBeenCalled(); expect(m.estornar).toHaveBeenCalledOnce();
  });
  it.each(["CELCASH", "ASAAS", "FORA", "MAQUININHA"])("aprovação %s prepara instrução sem fingir devolução", async meio => {
    m.pedido!.meio = meio;
    await executarEstorno(dono, "est1"); await executarEstorno(dono, "est1");
    expect(m.pedido).toMatchObject({ status: "APROVADO", instrucao: expect.any(String), executadoEm: null });
    expect(m.estornar).not.toHaveBeenCalled(); expect(m.caixa).not.toHaveBeenCalled(); expect(m.pagamento.estornadoCentavos).toBe(0);
  });
  it("confirmação externa exige dono, comprovante, titular ativo e referência não reutilizada", async () => {
    await expect(registrarManual({ ...dono, papel: "GERENTE" }, "est1", "ref1")).rejects.toMatchObject({ status: 403 });
    await expect(registrarManual(dono, "est1", " ")).rejects.toMatchObject({ codigo: "comprovante_estorno" });
    m.donoAtivo = false;
    await expect(registrarManual(dono, "est1", "ref1")).rejects.toMatchObject({ status: 403 });
    m.donoAtivo = true; m.duplicado = true;
    await expect(registrarManual(dono, "est1", "ref1")).rejects.toMatchObject({ codigo: "comprovante_repetido" });
    expect(m.pagamento.estornadoCentavos).toBe(0);
  });
  it("comprovante só aplica o valor uma vez e registra referência para auditoria", async () => {
    m.pedido!.meio = "CELCASH";
    await executarEstorno(dono, "est1"); await registrarManual(dono, "est1", "Comprovante 001");
    await expect(registrarManual(dono, "est1", "Comprovante 001")).rejects.toMatchObject({ codigo: "ja_decidido" });
    expect(m.pedido).toMatchObject({ status: "MANUAL", instrucao: "Comprovante 001" }); expect(m.pagamento.estornadoCentavos).toBe(5000);
    expect(m.efeitosLink).toHaveBeenCalledOnce(); expect(m.estornar).not.toHaveBeenCalled();
  });
  it("falha de registro após API aceita preserva conferência e não devolve novamente", async () => {
    m.falharConclusao = true;
    await executarEstorno(dono, "est1"); await executarEstorno(dono, "est1");
    expect(m.pedido).toMatchObject({ status: "APROVADO", gatewayEstornoId: "tran_refund", instrucao: expect.any(String) });
    expect(m.pagamento.estornadoCentavos).toBe(0); expect(m.estornar).toHaveBeenCalledOnce();
    await registrarManual(dono, "est1", "tran_refund"); expect(m.pagamento.estornadoCentavos).toBe(5000);
  });
  it("falha legada não reinicia execução financeira", async () => {
    m.pedido!.status = "FALHOU"; await executarEstorno(dono, "est1");
    expect(m.estornar).not.toHaveBeenCalled(); expect(m.pedido!.status).toBe("FALHOU");
  });
  it("ação tentar da interface também bloqueia reenvio de falha legada", async () => {
    m.pedido!.status = "FALHOU";
    await expect(decidirEstorno(dono, "est1", { acao: "tentar" })).rejects.toMatchObject({ codigo: "estorno_em_conferencia" });
    expect(m.estornar).not.toHaveBeenCalled(); expect(m.pedido!.status).toBe("FALHOU");
  });
  it("não permite comprovar acima do saldo ou fingir sangria sem identificação", async () => {
    m.jaDevolvido = 1000;
    await expect(registrarManual(dono, "est1", "ref1")).rejects.toMatchObject({ codigo: "estorno_conciliado" });
    m.jaDevolvido = 0; m.pedido!.meio = "DINHEIRO";
    await expect(registrarManual(dono, "est1", "ref1")).rejects.toMatchObject({ codigo: "sangria_nao_conciliada" });
    expect(m.pagamento.estornadoCentavos).toBe(0);
  });
});
