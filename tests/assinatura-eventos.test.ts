import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CobrancaGateway } from "@/lib/pagamentos/gateway";

type Registro = { id: string; tipo: string; cobrancaId: string; estado: string; tentativaToken: string | null; tentativas: number; atualizadoEm: Date | null; concluidoEm: Date | null };
const m = vi.hoisted(() => ({ row: null as Registro | null, buscar: vi.fn(), sincronizar: vi.fn(), auditar: vi.fn(), aplicar: vi.fn(), status: "PENDENTE", semVinculo: false }));
vi.mock("@/lib/db", () => {
  const tx = {
    $executeRaw: vi.fn(),
    eventoPagamento: {
      findUnique: async () => m.row && { ...m.row },
      create: async ({ data }: { data: Registro }) => { m.row = { ...data, concluidoEm: null }; return m.row; },
      update: async ({ data }: { data: Partial<Registro> }) => { m.row = { ...m.row!, ...data }; return m.row; },
      updateMany: async ({ where, data }: { where: Partial<Registro>; data: Partial<Registro> }) => {
        if (!m.row || !Object.entries(where).every(([k, v]) => m.row![k as keyof Registro] === v)) return { count: 0 };
        m.row = { ...m.row, ...data }; return { count: 1 };
      },
    },
  };
  return { db: { ...tx, $transaction: async (fn: (c: typeof tx) => Promise<unknown>) => fn(tx),
    cobranca: { findUnique: async () => m.semVinculo ? null : ({ assinatura: { id: "assinatura-local", gatewayId: "sub_ficticia", status: m.status, clienteId: "cliente-ficticio" } }) },
    assinatura: { findUnique: async () => null },
  } };
});
vi.mock("@/lib/pagamentos/gateway", () => ({ gatewayPorId: async () => ({ buscarCobranca: m.buscar }) }));
vi.mock("@/lib/auditoria", () => ({ auditar: m.auditar }));
vi.mock("@/lib/recuperacao/quarentena", () => ({ quarentenaRestauracao: () => false }));
vi.mock("@/lib/assinaturas/agenda", () => ({ aplicarPlanoAosFuturos: m.aplicar }));
vi.mock("@/lib/agenda/carregar", () => ({ configuracao: async () => ({ fuso: "America/Sao_Paulo" }) }));
import { FalhaSincronizacaoAssinatura, processarEventoAssinatura } from "@/lib/assinaturas/eventos";

const cob: CobrancaGateway = { id: "ch_ficticia", assinaturaGatewayId: "sub_ficticia", valorCentavos: 1000, vencimento: "2026-11-01", status: "PAGA", pagaEm: "2026-11-02T12:00:00Z", link: null };
const executar = () => processarEventoAssinatura("evento-ficticio", "charge.paid", cob.id, m.sincronizar);
beforeEach(() => {
  vi.clearAllMocks(); m.row = null; m.status = "PENDENTE"; m.semVinculo = false;
  m.buscar.mockResolvedValue(cob); m.sincronizar.mockResolvedValue({ de: "PENDENTE", para: "ATIVA" });
  m.auditar.mockResolvedValue(undefined); m.aplicar.mockResolvedValue(0);
});

describe("recepção durável de eventos de assinatura", () => {
  it("falha não consome o evento; repetir consulta a API novamente e conclui sem novo pagamento", async () => {
    m.sincronizar.mockRejectedValueOnce(new Error("Falha DB fictícia"));
    await expect(executar()).rejects.toMatchObject({ podeRetentar: true });
    expect(m.row).toMatchObject({ estado: "FALHOU", tentativas: 1, concluidoEm: null });
    expect(await executar()).toMatchObject({ repetido: false, transicao: { para: "ATIVA" } });
    expect(m.buscar).toHaveBeenCalledTimes(2);
    expect(m.row).toMatchObject({ estado: "CONCLUIDO", tentativas: 2 });
    expect(await executar()).toEqual({ repetido: true, legado: false });
    expect(m.buscar).toHaveBeenCalledTimes(2);
  });
  it("falha de consulta também conserva claim e permite nova leitura", async () => {
    m.buscar.mockRejectedValueOnce(new Error("Timeout fictício"));
    await expect(executar()).rejects.toBeInstanceOf(FalhaSincronizacaoAssinatura);
    expect(m.sincronizar).not.toHaveBeenCalled();
    await executar(); expect(m.row?.tentativas).toBe(2);
  });
  it("queda após commit não repete aviso; reconcilia a agenda local de forma idempotente", async () => {
    m.sincronizar.mockImplementationOnce(async () => { m.status = "ATIVA"; throw new Error("Queda após commit"); });
    await expect(executar()).rejects.toMatchObject({ podeRetentar: true });
    m.sincronizar.mockResolvedValue({ de: "ATIVA", para: "ATIVA" });
    await executar(); expect(m.aplicar).toHaveBeenCalledWith("cliente-ficticio", "America/Sao_Paulo");
    expect(m.aplicar).toHaveBeenCalledOnce();
  });
  it("um claim vigente impede outra execução e não é sobrescrito", async () => {
    let liberar!: () => void;
    m.sincronizar.mockImplementationOnce(() => new Promise(resolve => { liberar = () => resolve({ de: "PENDENTE", para: "ATIVA" }); }));
    const primeira = executar();
    await vi.waitFor(() => expect(m.sincronizar).toHaveBeenCalledOnce());
    const token = m.row?.tentativaToken;
    await expect(executar()).rejects.toMatchObject({ podeRetentar: true });
    expect(m.row?.tentativaToken).toBe(token); expect(m.row?.tentativas).toBe(1);
    liberar(); await primeira;
  });
  it("finalização tardia não altera conclusão de um token novo após expiração", async () => {
    let liberar!: () => void;
    m.sincronizar.mockImplementationOnce(() => new Promise(resolve => { liberar = () => resolve({ de: "PENDENTE", para: "ATIVA" }); }));
    const primeira = executar(); const rejeicao = expect(primeira).rejects.toMatchObject({ podeRetentar: true });
    await vi.waitFor(() => expect(m.sincronizar).toHaveBeenCalledOnce());
    m.row!.atualizadoEm = new Date(0);
    await executar(); const tokenNovo = m.row?.tentativaToken;
    liberar(); await rejeicao;
    expect(m.row).toMatchObject({ estado: "CONCLUIDO", tentativaToken: tokenNovo, tentativas: 2 });
  });
  it("limita falhas e mantém o evento para conferência, sem loop de execução", async () => {
    m.buscar.mockRejectedValue(new Error("Indisponível"));
    for (let i = 1; i <= 5; i++) await expect(executar()).rejects.toMatchObject({ podeRetentar: i < 5 });
    await expect(executar()).rejects.toMatchObject({ podeRetentar: false });
    expect(m.buscar).toHaveBeenCalledTimes(5); expect(m.row?.estado).toBe("FALHOU");
  });
  it("legado permanece deduplicado e não é anunciado como nova prova homologada", async () => {
    m.row = { id: "evento-ficticio", tipo: "charge.paid", cobrancaId: cob.id, estado: "LEGADO", tentativaToken: null, tentativas: 0, atualizadoEm: null, concluidoEm: null };
    expect(await executar()).toEqual({ repetido: true, legado: true }); expect(m.buscar).not.toHaveBeenCalled();
    await expect(processarEventoAssinatura("evento-ficticio", "tipo-diferente", cob.id, m.sincronizar)).rejects.toMatchObject({ codigo: "evento_divergente" });
  });
  it("referência remota diferente ou assinatura ausente exigem revisão sem sincronizar", async () => {
    m.buscar.mockResolvedValueOnce({ ...cob, id: "outra-cobranca" });
    await expect(executar()).rejects.toMatchObject({ podeRetentar: false });
    m.semVinculo = true;
    await expect(executar()).rejects.toMatchObject({ podeRetentar: false }); expect(m.sincronizar).not.toHaveBeenCalled();
  });
});
