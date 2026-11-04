import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PedidoEstorno } from "@prisma/client";
import type { Sessao } from "@/lib/auth/sessao";

const m = vi.hoisted(() => ({
  pedidos: [] as PedidoEstorno[], aprova: true, executar: vi.fn(), auditar: vi.fn(),
  fila: Promise.resolve() as Promise<unknown>,
}));
vi.mock("@/lib/db", () => {
  type Filtro = { tipo: string; referenciaId: string; status: { in: string[] } };
  const selecionar = (where: Filtro) => m.pedidos.filter(p => p.tipo === where.tipo && p.referenciaId === where.referenciaId && where.status.in.includes(p.status));
  const tx = {
    $queryRaw: vi.fn(), $executeRaw: vi.fn(),
    pedidoEstorno: {
      findFirst: async ({ where }: { where: Filtro }) => selecionar(where)[0] ?? null,
      aggregate: async ({ where }: { where: Filtro }) => ({ _sum: { valorCentavos: selecionar(where).reduce((s, p) => s + p.valorCentavos, 0) } }),
      create: async ({ data }: { data: Partial<PedidoEstorno> }) => {
        const p = { id: `est${m.pedidos.length + 1}`, status: "PENDENTE", instrucao: null, ...data } as PedidoEstorno;
        m.pedidos.push(p); return p;
      },
    },
  };
  return { db: { ...tx, $transaction: (fn: (t: typeof tx) => Promise<unknown>) => {
    const proxima = m.fila.then(() => fn(tx)); m.fila = proxima.catch(() => {}); return proxima;
  } } };
});
vi.mock("@/lib/estornos/alvo", () => ({
  carregarAlvo: async (_tipo: string, id: string) => ({
    tipo: "LINK", referenciaId: id === "pg-link1" ? "link1" : id, valorOriginal: 5000, gatewayId: "or_teste",
    meio: "PAGARME", forma: "ONLINE", descricao: "Link sintético", clienteNome: "Cliente sintético",
    comandaId: null, pagamentoComandaId: null, liquidoComanda: null, bloqueio: null,
  }),
  exigirEstornavel: vi.fn(),
}));
vi.mock("@/lib/estornos/executar", () => ({ executarEstorno: m.executar, registrarManual: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ auditar: m.auditar }));
vi.mock("@/lib/auth/permissoes", () => ({ pode: async () => m.aprova, telefonesCom: async () => [] }));
vi.mock("@/lib/financeiro/caixa", () => ({ caixaAberto: vi.fn() }));
vi.mock("@/lib/whatsapp/conversas", () => ({ notificarCliente: vi.fn() }));
import { pedirEstorno } from "@/lib/estornos/servico";

const dono = { usuarioId: "dono", papel: "DONO", nome: "Dono" } as Sessao;
const pedido = { tipo: "LINK" as const, referenciaId: "link1", valorCentavos: 1000, motivo: "Devolução parcial" };

beforeEach(() => {
  vi.clearAllMocks(); m.pedidos = []; m.aprova = true; m.fila = Promise.resolve();
  m.executar.mockImplementation(async (_s, id) => {
    const p = m.pedidos.find(x => x.id === id)!;
    p.instrucao = "Retorno externo em conferência";
    return p;
  });
});

describe("um pedido em andamento por pagamento, inclusive estorno parcial", () => {
  it.each(["PENDENTE", "APROVADO", "FALHOU"] as const)("bloqueia novo pedido quando já existe %s, mesmo sobrando saldo", async status => {
    m.pedidos.push({ id: "anterior", tipo: "LINK", referenciaId: "link1", valorCentavos: 1000, status } as PedidoEstorno);
    await expect(pedirEstorno(dono, pedido)).rejects.toMatchObject({ status: 409, codigo: "estorno_em_conferencia" });
    expect(m.pedidos).toHaveLength(1); expect(m.executar).not.toHaveBeenCalled(); expect(m.auditar).not.toHaveBeenCalled();
  });
  it("reenvio após retorno incerto não cria outro ID nem repete a devolução", async () => {
    await pedirEstorno(dono, pedido);
    await expect(pedirEstorno(dono, pedido)).rejects.toMatchObject({ codigo: "estorno_em_conferencia" });
    expect(m.pedidos).toHaveLength(1); expect(m.executar).toHaveBeenCalledOnce();
  });
  it("duas solicitações simultâneas por referências equivalentes criam só um pedido", async () => {
    const respostas = await Promise.allSettled([
      pedirEstorno(dono, pedido),
      pedirEstorno(dono, { ...pedido, tipo: "COMANDA", referenciaId: "pg-link1" }),
    ]);
    expect(respostas.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(respostas.find(r => r.status === "rejected")).toMatchObject({ reason: { codigo: "estorno_em_conferencia" } });
    expect(m.pedidos).toHaveLength(1); expect(m.executar).toHaveBeenCalledOnce();
  });
  it("recepção também não cria outra pendência parcial", async () => {
    m.aprova = false;
    await pedirEstorno({ ...dono, papel: "RECEPCAO" }, pedido);
    await expect(pedirEstorno({ ...dono, papel: "RECEPCAO" }, pedido)).rejects.toMatchObject({ codigo: "estorno_em_conferencia" });
    expect(m.pedidos).toHaveLength(1); expect(m.executar).not.toHaveBeenCalled();
  });
  it.each(["EXECUTADO", "MANUAL"] as const)("após %s permite próximo parcial, respeitando o saldo restante", async status => {
    m.pedidos.push({ id: "anterior", tipo: "LINK", referenciaId: "link1", valorCentavos: 1000, status } as PedidoEstorno);
    await expect(pedirEstorno(dono, { ...pedido, valorCentavos: 4001 })).rejects.toThrow(/máximo/);
    await expect(pedirEstorno(dono, { ...pedido, valorCentavos: 4000 })).resolves.toMatchObject({ valorCentavos: 4000 });
    expect(m.pedidos).toHaveLength(2); expect(m.executar).toHaveBeenCalledOnce();
  });
  it("recusa libera nova solicitação e outro pagamento não é bloqueado", async () => {
    m.pedidos.push({ id: "recusado", tipo: "LINK", referenciaId: "link1", valorCentavos: 1000, status: "RECUSADO" } as PedidoEstorno);
    await expect(pedirEstorno(dono, pedido)).resolves.toMatchObject({ status: "APROVADO" });
    await expect(pedirEstorno(dono, { ...pedido, referenciaId: "link2" })).resolves.toMatchObject({ referenciaId: "link2" });
    expect(m.executar).toHaveBeenCalledTimes(2);
  });
});
