import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sessao } from "@/lib/auth/sessao";
import type { PedidoPOS } from "@/lib/pagamentos/pagarme";
import { dataLocal } from "@/lib/agenda/tempo";

type Pago = {
  id: string; comandaId: string; forma: "CREDITO" | "DEBITO"; valorCentavos: number;
  status: "AGUARDANDO" | "PAGO" | "CANCELADO"; gatewayPedidoId: string | null;
  registradoPorId: string; estornadoCentavos: number; antecipadoId: null; linkPagamentoId: null;
  comanda: { numero: number; status: string }; pagoEm?: Date; estornadoEm?: Date;
};
type Estorno = { id: string; status: string; valorCentavos: number };
const m = vi.hoisted(() => ({
  pagamentos: new Map<string, Pago>(), enviar: vi.fn(), buscar: vi.fn(), fechar: vi.fn(),
  auditar: vi.fn(), avisar: vi.fn(), lancar: vi.fn(), link: vi.fn(), antesAtualizar: vi.fn(), estornos: [] as Estorno[],
  travarAgenda: vi.fn(), comanda: vi.fn(),
}));
vi.mock("@/lib/pagamentos/pagarme", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/pagamentos/pagarme")>(),
  criarPedidoMaquininha: m.enviar, buscarPedido: m.buscar, fecharPedido: m.fechar,
}));
vi.mock("@/lib/auditoria", () => ({ auditar: m.auditar }));
vi.mock("@/lib/auth/permissoes", () => ({ pode: async () => true }));
vi.mock("@/lib/comandas/servico", () => ({ avisarComanda: m.avisar, ehGerente: () => true, lancarPagamento: m.lancar }));
vi.mock("@/lib/comandas/agenda-comanda", () => ({ travarAgendaComanda: m.travarAgenda }));
vi.mock("@/lib/db", () => {
  const pagamentos = {
    findUnique: async ({ where }: { where: { id?: string; gatewayPedidoId?: string } }) => where.id
      ? m.pagamentos.get(where.id) ?? null : [...m.pagamentos.values()].find((p) => p.gatewayPedidoId === where.gatewayPedidoId) ?? null,
    findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
      const pg = m.pagamentos.get(where.id); if (!pg) throw Error("inexistente"); return { ...pg };
    },
    findFirst: async ({ where }: { where: { comandaId: string; status: string } }) => [...m.pagamentos.values()].find((p) => p.comandaId === where.comandaId && p.status === where.status) ?? null,
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Pago> }) => {
      m.antesAtualizar();
      let count = 0;
      for (const pg of m.pagamentos.values()) {
        if (Object.entries(where).every(([k, v]) => typeof v === "object" && v !== null && "in" in v
          ? (v.in as unknown[]).includes(pg[k as keyof Pago]) : pg[k as keyof Pago] === v)) { Object.assign(pg, data); count++; }
      }
      return { count };
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<Pago> }) => {
      const pg = m.pagamentos.get(where.id)!; Object.assign(pg, data); return { ...pg };
    },
  };
  const estornos = {
    aggregate: async () => ({ _sum: { valorCentavos: m.estornos.filter((e) => ["EXECUTADO", "MANUAL"].includes(e.status)).reduce((s, e) => s + e.valorCentavos, 0) } }),
    findFirst: async ({ where }: { where: { valorCentavos?: number } }) => m.estornos.find((e) => e.status === "APROVADO" && e.valorCentavos === where.valorCentavos) ?? null,
    create: async ({ data }: { data: Omit<Estorno, "id"> }) => { const e = { id: `est${m.estornos.length}`, ...data }; m.estornos.push(e); return e; },
    update: async ({ where, data }: { where: { id: string }; data: Partial<Estorno> }) => Object.assign(m.estornos.find((e) => e.id === where.id)!, data),
    updateMany: async () => { const es = m.estornos.filter((e) => ["PENDENTE", "APROVADO", "FALHOU"].includes(e.status)); es.forEach((e) => e.status = "RECUSADO"); return { count: es.length }; },
  };
  const tx = { pagamentoComanda: pagamentos, pedidoEstorno: estornos, linkPagamento: { findFirst: m.link }, comanda: { findFirst: m.comanda }, $queryRaw: async () => [] };
  return { db: { ...tx, $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } };
});
import { cancelarPagamento, registrarPagamento, simularAprovacao, sincronizarPedido } from "@/lib/comandas/maquininha";
import { ErroPagarme } from "@/lib/pagamentos/pagarme";

const sessao: Sessao = { usuarioId: "recepcao", nome: "Recepção", papel: "RECEPCAO", barbeiroId: null, clienteId: null };
const barbeiro: Sessao = { ...sessao, usuarioId: "u-barbeiro", papel: "BARBEIRO", barbeiroId: "b1" };
const entrada = { forma: "CREDITO" as const, valorCentavos: 1000, naMaquininha: true, solicitacaoId: "15d825a4-1f5f-478b-8feb-3ac0f7a11c44" };
const idEntrada = `pos_${entrada.solicitacaoId.replaceAll("-", "")}`;
const criarPago = (extra: Partial<Pago> = {}): Pago => ({
  id: "pg1", comandaId: "cmd1", forma: "CREDITO", valorCentavos: 1000, status: "AGUARDANDO", gatewayPedidoId: "or_1",
  registradoPorId: "recepcao", estornadoCentavos: 0, antecipadoId: null, linkPagamentoId: null, comanda: { numero: 42, status: "ABERTA" }, ...extra,
});
const pedido = (extra: Partial<PedidoPOS> = {}): PedidoPOS => ({
  id: "or_1", code: "cmd-42-pg1", status: "pending", currency: "BRL", amount: 1000,
  metadata: { pagamento_id: "pg1", comanda_id: "cmd1" }, charges: [], ...extra,
});
const charge = (extra: Partial<NonNullable<PedidoPOS["charges"]>[number]> = {}) => ({
  id: "ch_1", status: "paid", amount: 1000, paid_amount: 1000, currency: "BRL", code: "NSU1", metadata: { scheme_name: "Visa" }, ...extra,
});
beforeEach(() => {
  vi.clearAllMocks(); m.pagamentos.clear(); m.estornos.length = 0;
  vi.stubEnv("MAQUININHA", "stone"); vi.stubEnv("AMBIENTE", "local");
  vi.stubEnv("STONE_POS_SERIAL", "SERIAL1"); vi.stubEnv("PAGARME_SECRET_KEY", "sk_test_falsa");
  vi.stubEnv("STONE_POS_SERVICE_REFERER_NAME", "parceiro-ficticio");
  vi.stubEnv("STONE_POS_SPLIT_JSON", '[{"amount":100,"recipient_id":"rp_ficticio","type":"percentage","options":{"liable":true,"charge_processing_fee":true,"charge_remainder_fee":true}}]');
  m.link.mockResolvedValue(null); m.fechar.mockResolvedValue(undefined);
  m.comanda.mockResolvedValue(null);
  m.enviar.mockImplementation(async (p: { referencia: string; valorCentavos: number; metadata: Record<string, string> }) =>
    pedido({ code: p.referencia, amount: p.valorCentavos, metadata: p.metadata }));
  m.buscar.mockResolvedValue(pedido());
  m.lancar.mockImplementation(async (_tx, s: Sessao, comandaId: string, p: { id?: string; forma: Pago["forma"]; valorCentavos: number }) => {
    const pg = criarPago({ id: p.id ?? "pg1", comandaId, gatewayPedidoId: null, forma: p.forma, valorCentavos: p.valorCentavos, registradoPorId: s.usuarioId }); m.pagamentos.set(pg.id, pg);
    return { pagamento: { ...pg }, comanda: { numero: 42, cliente: { nome: "Cliente" } } };
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("POS: envio e intenção persistente", () => {
  it.each(["BARBEIRO", "LIDER", "CLIENTE"] as const)("%s sem vínculo permitido não registra nem cancela por chamada direta", async (papel) => {
    const s = { ...sessao, papel };
    await expect(registrarPagamento(s, "cmd1", entrada)).rejects.toMatchObject({ status: 403 });
    await expect(cancelarPagamento(s, "pg1")).rejects.toMatchObject({ status: 403 });
    expect(m.lancar).not.toHaveBeenCalled(); expect(m.enviar).not.toHaveBeenCalled();
  });
  it("envia o débito da comanda própria ao terminal padrão e bloqueia a repetição", async () => {
    m.comanda.mockResolvedValue({ id: "cmd1" });
    const debito = { ...entrada, forma: "DEBITO" as const };
    const pg = await registrarPagamento(barbeiro, "cmd1", debito);
    const repetido = await registrarPagamento(barbeiro, "cmd1", debito);
    expect(repetido.id).toBe(pg.id);
    expect(pg.status).toBe("AGUARDANDO");
    expect(m.travarAgenda).toHaveBeenCalledWith(expect.anything(), "cmd1");
    expect(m.enviar).toHaveBeenCalledOnce();
    expect(m.enviar).toHaveBeenCalledWith(expect.objectContaining({ tipo: "debit", serial: "SERIAL1" }), expect.anything());
    await expect(cancelarPagamento(barbeiro, pg.id)).rejects.toMatchObject({ status: 403 });
  });
  it("nega pagamento da comanda fora do escopo antes de lançar intenção", async () => {
    await expect(registrarPagamento(barbeiro, "cmd-alheia", entrada)).rejects.toMatchObject({ status: 403 });
    expect(m.lancar).not.toHaveBeenCalled(); expect(m.enviar).not.toHaveBeenCalled();
  });
  it.each([{ naMaquininha: false }, { forma: "DINHEIRO" as const }, { forma: "PIX" as const }, { serial: "SERIAL1" }])("não deixa o barbeiro escolher outras formas de registrar: %j", async (extra) => {
    await expect(registrarPagamento(barbeiro, "cmd1", { ...entrada, ...extra })).rejects.toMatchObject({ status: 403 });
    expect(m.comanda).not.toHaveBeenCalled(); expect(m.enviar).not.toHaveBeenCalled();
  });
  it.each(["manual", "simulada"])("o barbeiro não envia cobrança quando o modo é %s", async (modo) => {
    vi.stubEnv("MAQUININHA", modo);
    await expect(registrarPagamento(barbeiro, "cmd1", entrada)).rejects.toMatchObject({ status: 403 });
    expect(m.lancar).not.toHaveBeenCalled(); expect(m.enviar).not.toHaveBeenCalled();
  });
  it("selecionar forma cria uma intenção e envia um único pedido com serial e metadados", async () => {
    const pg = await registrarPagamento(sessao, "cmd1", entrada);
    expect(pg.gatewayPedidoId).toBe("or_1"); expect(pg.status).toBe("AGUARDANDO");
    expect(m.enviar).toHaveBeenCalledWith(expect.objectContaining({ tipo: "credit", serial: "SERIAL1", referencia: `cmd-42-${idEntrada}`, metadata: { pagamento_id: idEntrada, comanda_id: "cmd1" } }), expect.anything());
  });
  it("repetição da mesma cobrança pendente não envia outro pedido", async () => {
    await registrarPagamento(sessao, "cmd1", entrada); await registrarPagamento(sessao, "cmd1", entrada);
    expect(m.enviar).toHaveBeenCalledTimes(1); expect(m.lancar).toHaveBeenCalledTimes(1);
  });
  it("repete a mesma ação depois de paga e recusa a chave com outros dados", async () => {
    await registrarPagamento(sessao, "cmd1", entrada);
    m.pagamentos.get(idEntrada)!.status = "PAGO";
    expect(await registrarPagamento(sessao, "cmd1", entrada)).toMatchObject({ id: idEntrada, status: "PAGO" });
    await expect(registrarPagamento(sessao, "cmd1", { ...entrada, valorCentavos: 500 })).rejects.toMatchObject({ codigo: "solicitacao_pos" });
    await expect(registrarPagamento(sessao, "outra", entrada)).rejects.toMatchObject({ codigo: "solicitacao_pos" });
    expect(m.enviar).toHaveBeenCalledOnce();
  });
  it("falha de rede preserva pendência, bloqueia cancelamento e não repete POST", async () => {
    m.enviar.mockRejectedValueOnce(new TypeError("connection reset"));
    await expect(registrarPagamento(sessao, "cmd1", entrada)).rejects.toMatchObject({ codigo: "maquininha_incerta" });
    expect(m.pagamentos.get(idEntrada)?.status).toBe("AGUARDANDO");
    await expect(cancelarPagamento(sessao, idEntrada)).rejects.toMatchObject({ codigo: "maquininha_incerta" });
    await registrarPagamento(sessao, "cmd1", entrada); expect(m.enviar).toHaveBeenCalledTimes(1);
  });
  it.each([409, 500, 502])("retorno %s preserva resultado desconhecido", async (status) => {
    m.enviar.mockRejectedValueOnce(new ErroPagarme(status, "incerto"));
    await expect(registrarPagamento(sessao, "cmd1", entrada)).rejects.toMatchObject({ codigo: "maquininha_incerta" });
    expect(m.pagamentos.get(idEntrada)?.status).toBe("AGUARDANDO");
  });
  it("rejeição HTTP explícita sem pedido não deixa reserva presa", async () => {
    m.enviar.mockRejectedValueOnce(new ErroPagarme(422, "Device not found"));
    await expect(registrarPagamento(sessao, "cmd1", entrada)).rejects.toMatchObject({ codigo: "maquininha" });
    expect(m.pagamentos.get(idEntrada)?.status).toBe("CANCELADO");
  });
  it("serial inválido e credencial ausente falham antes de criar pagamento", async () => {
    await expect(registrarPagamento(sessao, "cmd1", { ...entrada, serial: "outra" })).rejects.toMatchObject({ codigo: "maquininha" });
    vi.stubEnv("PAGARME_SECRET_KEY", "");
    await expect(registrarPagamento(sessao, "cmd1", entrada)).rejects.toMatchObject({ codigo: "config" });
    expect(m.lancar).not.toHaveBeenCalled(); expect(m.enviar).not.toHaveBeenCalled();
  });
  it("bloqueia modo manual e integração incompleta antes de lançar cobrança", async () => {
    vi.stubEnv("MAQUININHA", "manual");
    await expect(registrarPagamento(sessao, "cmd1", entrada)).rejects.toMatchObject({ codigo: "maquininha_desativada" });
    vi.stubEnv("MAQUININHA", "stone");
    await expect(registrarPagamento(sessao, "cmd1", { ...entrada, solicitacaoId: undefined })).rejects.toMatchObject({ codigo: "solicitacao_pos" });
    vi.stubEnv("STONE_POS_SPLIT_JSON", "[]");
    await expect(registrarPagamento(sessao, "cmd1", entrada)).rejects.toMatchObject({ codigo: "config" });
    expect(m.lancar).not.toHaveBeenCalled(); expect(m.enviar).not.toHaveBeenCalled();
  });
  it("a trava de cobranças reais prevalece antes de reservar o pagamento Stone", async () => {
    vi.stubEnv("PAGAMENTOS_COBRANCAS_REAIS_BLOQUEADAS", "true");
    await expect(registrarPagamento(sessao, "cmd1", entrada)).rejects.toMatchObject({ codigo: "cobrancas_reais_bloqueadas" });
    expect(m.lancar).not.toHaveBeenCalled(); expect(m.enviar).not.toHaveBeenCalled();
  });
  it("impede substituir cobrança pendente por dinheiro ou outra quantia", async () => {
    m.pagamentos.set("pg1", criarPago());
    await expect(registrarPagamento(sessao, "cmd1", { ...entrada, valorCentavos: 500 })).rejects.toMatchObject({ codigo: "pagamento_pendente" });
    await expect(registrarPagamento(sessao, "cmd1", { ...entrada, forma: "DINHEIRO", naMaquininha: false })).rejects.toMatchObject({ codigo: "pagamento_pendente" });
    expect(m.enviar).not.toHaveBeenCalled();
  });
  it("link pendente impede cobrança simultânea", async () => {
    m.link.mockResolvedValueOnce({ id: "link1" });
    await expect(registrarPagamento(sessao, "cmd1", entrada)).rejects.toMatchObject({ codigo: "link_pendente" });
    expect(m.enviar).not.toHaveBeenCalled(); expect(m.lancar).not.toHaveBeenCalled();
  });
});

describe("POS: retorno autoritativo e cancelamento", () => {
  beforeEach(() => m.pagamentos.set("pg1", criarPago()));
  it("homologação não consulta pedido real mesmo que exista vínculo copiado", async () => {
    vi.stubEnv("AMBIENTE", "homologacao");
    await expect(sincronizarPedido("or_1")).rejects.toMatchObject({ codigo: "homologacao" });
    expect(m.buscar).not.toHaveBeenCalled();
  });
  it("confirma só valor integral em BRL e deduplica auditoria", async () => {
    m.buscar.mockResolvedValue(pedido({ charges: [charge()] }));
    await sincronizarPedido("or_1"); await sincronizarPedido("or_1");
    expect(m.pagamentos.get("pg1")).toMatchObject({ status: "PAGO", nsu: "NSU1", bandeira: "Visa" });
    expect(m.auditar).toHaveBeenCalledTimes(1);
  });
  it("confirmação atrasada mantém o dia de caixa do paid_at e repetição não move recebimento", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-04T18:00:00Z"));
    m.buscar.mockResolvedValueOnce(pedido({ charges: [charge({ paid_at: "2026-11-03T18:00:00Z" })] }))
      .mockResolvedValue(pedido({ charges: [charge({ paid_at: "2026-11-04T18:00:00Z" })] }));
    await sincronizarPedido("or_1"); await sincronizarPedido("or_1");
    const pagoEm = m.pagamentos.get("pg1")?.pagoEm;
    expect(pagoEm).toEqual(new Date("2026-11-03T18:00:00Z")); expect(dataLocal(pagoEm!, "America/Sao_Paulo")).toBe("2026-11-03");
    expect(m.auditar).toHaveBeenCalledOnce();
  });
  it("paid_at inválido usa instante da consulta com origem explícita na auditoria", async () => {
    const agora = new Date("2026-11-04T18:00:00Z"); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(agora);
    m.buscar.mockResolvedValue(pedido({ charges: [charge({ paid_at: "2026-02-30T12:00:00Z" })] }));
    await sincronizarPedido("or_1"); expect(m.pagamentos.get("pg1")?.pagoEm).toEqual(agora);
    expect(m.auditar).toHaveBeenLastCalledWith(expect.anything(), null, "maquininha_pagamento_confirmado", "comanda", "cmd1", expect.objectContaining({ origemData: "DATA_CONSULTA" }));
  });
  it("status paid do pedido sem cobrança liquidada não comprova pagamento", async () => {
    m.buscar.mockResolvedValue(pedido({ status: "paid" })); await sincronizarPedido("or_1");
    expect(m.pagamentos.get("pg1")?.status).toBe("AGUARDANDO"); expect(m.fechar).not.toHaveBeenCalled();
  });
  it("pagamento parcial não aprova nem cancela a intenção", async () => {
    m.buscar.mockResolvedValue(pedido({ status: "canceled", charges: [charge({ amount: 500, paid_amount: 500 })] }));
    await sincronizarPedido("or_1"); expect(m.pagamentos.get("pg1")?.status).toBe("AGUARDANDO");
  });
  it("retorno cancelado sem prova de recebimento zero não libera outra cobrança", async () => {
    m.buscar.mockResolvedValue(pedido({ status: "canceled", charges: [charge({ paid_amount: undefined })] }));
    await sincronizarPedido("or_1");
    expect(m.pagamentos.get("pg1")?.status).toBe("AGUARDANDO");
  });
  it.each([{ currency: "USD" }, { amount: 999 }, { id: "or_errado" }])("rejeita retorno divergente %j", async (extra) => {
    m.buscar.mockResolvedValue(pedido({ ...extra, charges: [charge()] }));
    await expect(sincronizarPedido("or_1")).rejects.toMatchObject({ codigo: "maquininha_divergente" });
    expect(m.pagamentos.get("pg1")?.status).toBe("AGUARDANDO");
  });
  it("recupera vínculo perdido por GET e identidade exata", async () => {
    m.pagamentos.set("pg1", criarPago({ gatewayPedidoId: null }));
    m.buscar.mockResolvedValue(pedido({ charges: [charge()] })); await sincronizarPedido("or_1");
    expect(m.pagamentos.get("pg1")).toMatchObject({ gatewayPedidoId: "or_1", status: "PAGO" });
  });
  it("não recupera pedido sem referência/metadata correspondentes", async () => {
    m.pagamentos.set("pg1", criarPago({ gatewayPedidoId: null }));
    m.buscar.mockResolvedValue(pedido({ code: "outra", charges: [charge()] }));
    expect(await sincronizarPedido("or_1")).toBe(false); expect(m.pagamentos.get("pg1")?.gatewayPedidoId).toBeNull();
  });
  it("avisa se outro pedido com a mesma intenção aparecer na recuperação", async () => {
    m.buscar.mockResolvedValue(pedido({ id: "or_duplicado", charges: [charge()] }));
    await expect(sincronizarPedido("or_duplicado")).rejects.toMatchObject({ codigo: "maquininha_divergente" });
    expect(m.pagamentos.get("pg1")).toMatchObject({ gatewayPedidoId: "or_1", status: "AGUARDANDO" });
    expect(m.fechar).not.toHaveBeenCalled();
  });
  it("pagamento aprovado durante cancelamento não é sobrescrito", async () => {
    m.buscar.mockResolvedValueOnce(pedido()).mockResolvedValueOnce(pedido({ charges: [charge()] }));
    await expect(cancelarPagamento(sessao, "pg1")).rejects.toMatchObject({ codigo: "maquininha_incerta" });
    expect(m.pagamentos.get("pg1")?.status).toBe("PAGO");
  });
  it("aprovação autoritativa tardia registra o dinheiro e exige conferência, sem ignorar venda", async () => {
    m.buscar.mockResolvedValueOnce(pedido({ status: "canceled" })).mockResolvedValueOnce(pedido({ charges: [charge()] }));
    await sincronizarPedido("or_1"); expect(m.pagamentos.get("pg1")?.status).toBe("CANCELADO");
    await expect(sincronizarPedido("or_1")).rejects.toMatchObject({ codigo: "maquininha_aprovacao_tardia" });
    expect(m.pagamentos.get("pg1")?.status).toBe("PAGO");
    expect(m.auditar).toHaveBeenLastCalledWith(expect.anything(), null, "maquininha_aprovacao_tardia", "comanda", "cmd1", expect.anything());
  });
  it("cancelamento só conclui quando GET confirma ausência de dinheiro recebido", async () => {
    m.buscar.mockResolvedValueOnce(pedido()).mockResolvedValueOnce(pedido({ status: "canceled" }));
    await cancelarPagamento(sessao, "pg1"); expect(m.pagamentos.get("pg1")?.status).toBe("CANCELADO");
    expect(m.fechar).toHaveBeenCalledWith("or_1", "canceled");
  });
  it("fechamento sem status confirmado mantém pendência", async () => {
    await expect(cancelarPagamento(sessao, "pg1")).rejects.toMatchObject({ codigo: "maquininha_incerta" });
    expect(m.pagamentos.get("pg1")?.status).toBe("AGUARDANDO");
  });
  it("estorno cumulativo do POS é conciliado uma vez, inclusive depois do pago", async () => {
    m.pagamentos.set("pg1", criarPago({ status: "PAGO", pagoEm: new Date("2026-11-01T12:00:00Z") }));
    m.buscar.mockResolvedValue(pedido({ status: "paid", charges: [charge({ status: "canceled", canceled_amount: 1000 })] }));
    await sincronizarPedido("or_1"); await sincronizarPedido("or_1");
    expect(m.pagamentos.get("pg1")).toMatchObject({ status: "CANCELADO", estornadoCentavos: 1000 });
    expect(m.estornos).toHaveLength(1); expect(m.estornos[0]).toMatchObject({ status: "EXECUTADO", valorCentavos: 1000 });
    expect(m.auditar).toHaveBeenCalledTimes(1);
  });
  it("retorno repetido não soma estorno já confirmado manualmente", async () => {
    m.pagamentos.set("pg1", criarPago({ status: "PAGO", estornadoCentavos: 500, pagoEm: new Date("2026-11-01T12:00:00Z") }));
    m.estornos.push({ id: "manual", status: "MANUAL", valorCentavos: 500 });
    m.buscar.mockResolvedValue(pedido({ charges: [charge({ canceled_amount: 500 })] }));
    await sincronizarPedido("or_1"); expect(m.pagamentos.get("pg1")?.estornadoCentavos).toBe(500);
    expect(m.auditar).not.toHaveBeenCalled();
  });
  it("confirma pedido aprovado existente sem criar outra despesa de estorno", async () => {
    m.pagamentos.set("pg1", criarPago({ status: "PAGO" }));
    m.estornos.push({ id: "aprovado", status: "APROVADO", valorCentavos: 1000 });
    m.buscar.mockResolvedValue(pedido({ charges: [charge({ status: "canceled", canceled_amount: 1000 })] }));
    await sincronizarPedido("or_1");
    expect(m.estornos).toHaveLength(1); expect(m.estornos[0]).toMatchObject({ id: "aprovado", status: "EXECUTADO", valorCentavos: 1000 });
  });
  it("concilia incrementos de devolução sem duplicar ledger e encerra pedido total já atendido", async () => {
    m.pagamentos.set("pg1", criarPago({ status: "PAGO" }));
    m.estornos.push({ id: "total", status: "APROVADO", valorCentavos: 1000 });
    m.buscar.mockResolvedValueOnce(pedido({ charges: [charge({ canceled_amount: 500 })] }))
      .mockResolvedValue(pedido({ charges: [charge({ status: "canceled", canceled_amount: 1000 })] }));
    await sincronizarPedido("or_1"); await sincronizarPedido("or_1"); await sincronizarPedido("or_1");
    expect(m.estornos.find((e) => e.id === "total")?.status).toBe("RECUSADO");
    expect(m.estornos.filter((e) => e.status === "EXECUTADO").reduce((s, e) => s + e.valorCentavos, 0)).toBe(1000);
    expect(m.pagamentos.get("pg1")?.estornadoCentavos).toBe(1000);
  });
  it.each([500, 1000])("devolução %s como primeiro retorno preserva entrada bruta e ledger", async canceled_amount => {
    m.buscar.mockResolvedValue(pedido({ charges: [charge({ status: canceled_amount === 1000 ? "canceled" : "paid", canceled_amount,
      paid_at: "2026-11-01T12:00:00Z", canceled_at: "2026-11-02T13:00:00Z" })] }));
    await sincronizarPedido("or_1"); await sincronizarPedido("or_1");
    expect(m.pagamentos.get("pg1")).toMatchObject({ pagoEm: new Date("2026-11-01T12:00:00Z"), estornadoCentavos: canceled_amount });
    expect(m.estornos.filter(e => e.status === "EXECUTADO").reduce((s, e) => s + e.valorCentavos, 0)).toBe(canceled_amount);
  });
  it("sem paid_at conserva entrada no instante da devolução e audita a data inferida", async () => {
    m.buscar.mockResolvedValue(pedido({ charges: [charge({ status: "canceled", canceled_amount: 1000, canceled_at: "2026-11-02T13:00:00Z" })] }));
    await sincronizarPedido("or_1");
    expect(m.pagamentos.get("pg1")?.pagoEm).toEqual(new Date("2026-11-02T13:00:00Z"));
    expect(m.auditar).toHaveBeenLastCalledWith(expect.anything(), null, "maquininha_recebimento_reconstituido", "comanda", "cmd1", expect.objectContaining({ origemData: "DATA_DEVOLUCAO" }));
  });
  it("devolução não reescreve instante de recebimento já registrado", async () => {
    const pagoEm = new Date("2026-10-31T12:00:00Z"); m.pagamentos.set("pg1", criarPago({ status: "PAGO", pagoEm }));
    m.buscar.mockResolvedValue(pedido({ charges: [charge({ status: "canceled", canceled_amount: 1000, paid_at: "2026-11-01T12:00:00Z" })] }));
    await sincronizarPedido("or_1"); expect(m.pagamentos.get("pg1")?.pagoEm).toEqual(pagoEm);
  });
});

describe("POS: simulação isolada por identidade", () => {
  it.each(["or_1", null, "sim_outro-pagamento"])("simulação recusa vínculo %s sem alterar pagamento", async gatewayPedidoId => {
    vi.stubEnv("MAQUININHA", "simulada");
    m.pagamentos.set("pg1", criarPago({ gatewayPedidoId }));
    await expect(simularAprovacao("pg1")).rejects.toMatchObject({ codigo: "simulacao_pagamento" });
    expect(m.pagamentos.get("pg1")?.status).toBe("AGUARDANDO"); expect(m.auditar).not.toHaveBeenCalled();
  });
  it("homologação não transforma pendência real em pagamento simulado", async () => {
    vi.stubEnv("AMBIENTE", "homologacao"); m.pagamentos.set("pg1", criarPago());
    await expect(simularAprovacao("pg1")).rejects.toMatchObject({ codigo: "simulacao_pagamento" });
    expect(m.pagamentos.get("pg1")?.status).toBe("AGUARDANDO"); expect(m.buscar).not.toHaveBeenCalled();
  });
  it("pagamento criado no simulador aprova uma vez e não chama o provedor", async () => {
    vi.stubEnv("MAQUININHA", "simulada"); m.pagamentos.set("pg1", criarPago({ gatewayPedidoId: "sim_pg1" }));
    await simularAprovacao("pg1"); await simularAprovacao("pg1");
    expect(m.pagamentos.get("pg1")?.status).toBe("PAGO"); expect(m.auditar).toHaveBeenCalledOnce();
    expect(m.buscar).not.toHaveBeenCalled(); expect(m.enviar).not.toHaveBeenCalled();
  });
  it("simulação não ressuscita pagamento cancelado", async () => {
    vi.stubEnv("MAQUININHA", "simulada"); m.pagamentos.set("pg1", criarPago({ gatewayPedidoId: "sim_pg1", status: "CANCELADO" }));
    await simularAprovacao("pg1"); expect(m.pagamentos.get("pg1")?.status).toBe("CANCELADO"); expect(m.auditar).not.toHaveBeenCalled();
  });
  it("vínculo alterado depois da leitura não recebe aprovação de simulação", async () => {
    vi.stubEnv("MAQUININHA", "simulada"); m.pagamentos.set("pg1", criarPago({ gatewayPedidoId: "sim_pg1" }));
    m.antesAtualizar.mockImplementationOnce(() => { m.pagamentos.get("pg1")!.gatewayPedidoId = "or_real"; });
    await simularAprovacao("pg1");
    expect(m.pagamentos.get("pg1")).toMatchObject({ gatewayPedidoId: "or_real", status: "AGUARDANDO" });
    expect(m.auditar).not.toHaveBeenCalled();
  });
});
