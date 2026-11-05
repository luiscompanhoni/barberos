import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import type { Sessao } from "@/lib/auth/token";
const m = vi.hoisted(() => ({ pedido: vi.fn(), contar: vi.fn(), criar: vi.fn(), atualizar: vi.fn(), agendamento: vi.fn(), tx: vi.fn(), auditar: vi.fn(), cfg: vi.fn(), profissional: vi.fn(), servicos: vi.fn(), reservar: vi.fn(), trava: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: (fn: (tx: unknown) => unknown) => m.tx(fn), pedidoAgendamento: { findUnique: m.pedido }, agendamento: { findUnique: m.agendamento } } }));
vi.mock("@/lib/auditoria", () => ({ auditar: m.auditar }));
vi.mock("@/lib/eventos", () => ({ publicar: vi.fn() }));
vi.mock("@/lib/auth/sessao", () => ({ BALCAO: ["DONO", "GERENTE", "RECEPCAO"] }));
vi.mock("@/lib/agenda/carregar", () => ({ configuracao: m.cfg }));
vi.mock("@/lib/agenda/agendamentos", () => ({ criarAgendamento: m.reservar }));
import { cancelarPedido, criarPedido, decidirPedido } from "@/lib/agenda/pedidos";
import { entradaPedido, mesmoPedido, validarPreferencia } from "@/lib/agenda/pedidos-regras";
import { concluirPedido, validarPedidoReserva } from "@/lib/agenda/pedidos-reserva";

const p = { chave: "dcb488cb-c178-4d48-95e1-a93d59fe7f73", servicoIds: ["corte", "barba"], barbeiroId: "b", dataPreferida: "2026-11-05", horaPreferida: "10:00", observacao: "" };
const pedido = { id: "p", clienteId: "c", ...p, status: "PENDENTE", agendamentoIds: null };
const ator = { usuarioId: "u", papel: "RECEPCAO", barbeiroId: null, clienteId: null, nome: "Equipe" } as Sessao;
const cfg = { agendaExternaAtiva: true, fuso: "America/Sao_Paulo", janelaAgendamentoDias: 30, antecedenciaMinimaMin: 30 };
const previa = { precoEsperadoCentavos: 8000, duracaoEsperadaMin: 60 };
const tx = { $executeRaw: m.trava, $queryRaw: m.trava, cliente: { findUnique: vi.fn(async () => ({ id: "c", usuarioId: "u", excluidoEm: null })) },
  usuario: { findUnique: vi.fn(async () => ({ id: "u", ativo: true, papel: "CLIENTE", sessaoVersao: 0 })) },
  pedidoAgendamento: { findUnique: m.pedido, findFirst: m.pedido, count: m.contar, create: m.criar, update: m.atualizar },
  servico: { count: m.servicos }, barbeiro: { findFirst: m.profissional }, agendamento: { findUnique: m.agendamento } } as unknown as Prisma.TransactionClient;

beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-04T12:00:00Z"));
  m.cfg.mockResolvedValue(cfg); m.pedido.mockResolvedValue(null); m.contar.mockResolvedValue(0); m.servicos.mockResolvedValue(2); m.profissional.mockResolvedValue({ id: "b" });
  m.criar.mockResolvedValue(pedido); m.tx.mockImplementation(fn => fn(tx)); m.reservar.mockResolvedValue({ id: "ag" });
});
afterEach(() => vi.useRealTimers());

describe("pedido nativo de agendamento", () => {
  it("grava um pedido auditado e não reserva nem confirma automaticamente", async () => {
    await expect(criarPedido("c", "u", p)).resolves.toEqual({ id: "p", status: "PENDENTE" });
    expect(m.criar).toHaveBeenCalledWith({ data: expect.objectContaining({ clienteId: "c", servicoIds: ["corte", "barba"] }) });
    expect(m.auditar).toHaveBeenCalledOnce(); expect(m.reservar).not.toHaveBeenCalled();
  });
  it("resposta perdida reaproveita o mesmo pedido, sem duplicar", async () => {
    m.pedido.mockResolvedValue(pedido);
    await expect(criarPedido("c", "u", p)).resolves.toMatchObject({ id: "p" });
    expect(m.criar).not.toHaveBeenCalled(); expect(m.contar).not.toHaveBeenCalled();
  });
  it("rejeita reaproveitar chave com conteúdo alterado", async () => {
    m.pedido.mockResolvedValue(pedido);
    await expect(criarPedido("c", "u", { ...p, horaPreferida: "11:00" })).rejects.toMatchObject({ status: 409, codigo: "pedido_repetido" });
    expect(m.criar).not.toHaveBeenCalled();
  });
  it("não cria pedido quando o modo direto voltou a estar disponível", async () => {
    m.cfg.mockResolvedValue({ ...cfg, agendaExternaAtiva: false });
    await expect(criarPedido("c", "u", p)).rejects.toMatchObject({ codigo: "agenda_direta" });
    expect(m.criar).not.toHaveBeenCalled();
  });
  it("limita pedidos pendentes sob trava do cliente", async () => {
    m.contar.mockResolvedValue(3);
    await expect(criarPedido("c", "u", p)).rejects.toMatchObject({ codigo: "limite_pedidos" });
    expect(m.trava).toHaveBeenCalled(); expect(m.criar).not.toHaveBeenCalled();
  });
  it("recusa serviço/profissional incompatível sem criar", async () => {
    m.profissional.mockResolvedValue(null);
    await expect(criarPedido("c", "u", p)).rejects.toMatchObject({ codigo: "catalogo_alterado" });
    expect(m.criar).not.toHaveBeenCalled();
  });
  it("cliente só cancela seu próprio pedido pendente", async () => {
    m.pedido.mockResolvedValue(null);
    await expect(cancelarPedido("p", "outro", "u")).rejects.toMatchObject({ status: 404 });
    expect(m.pedido).toHaveBeenCalledWith({ where: { id: "p", clienteId: "outro" } });
    expect(m.atualizar).not.toHaveBeenCalled();
    m.pedido.mockResolvedValue(pedido);
    await expect(cancelarPedido("p", "c", "u")).resolves.toMatchObject({ status: "CANCELADO" });
    expect(m.reservar).not.toHaveBeenCalled();
  });
  it("cancelamento não remove um horário já aprovado", async () => {
    m.pedido.mockResolvedValue({ ...pedido, status: "APROVADO" });
    await expect(cancelarPedido("p", "c", "u")).rejects.toMatchObject({ codigo: "pedido_decidido" });
    expect(m.atualizar).not.toHaveBeenCalled();
  });
  it("recusa aprovação por cliente/barbeiro e requer conferência explícita", async () => {
    const d = { ...previa, acao: "aprovar" as const, barbeiroId: "b", inicio: new Date("2026-11-05T13:00Z"), conferido: true as const };
    await expect(decidirPedido("p", { ...ator, papel: "CLIENTE" }, d)).rejects.toMatchObject({ status: 403 });
    await expect(decidirPedido("p", { ...ator, papel: "BARBEIRO" }, d)).rejects.toMatchObject({ status: 403 });
    m.pedido.mockResolvedValue(pedido);
    await expect(decidirPedido("p", ator, { ...d, conferido: false } as unknown as typeof d)).rejects.toMatchObject({ status: 422 });
    expect(m.reservar).not.toHaveBeenCalled();
  });
  it("equipe encaminha todos os serviços à transação da reserva, preservando origem do app", async () => {
    m.pedido.mockResolvedValue(pedido);
    const inicio = new Date("2026-11-05T13:00Z");
    await expect(decidirPedido("p", ator, { ...previa, acao: "aprovar", barbeiroId: "b", inicio, conferido: true })).resolves.toMatchObject({ status: "APROVADO", agendamentoId: "ag" });
    expect(m.reservar).toHaveBeenCalledWith(expect.objectContaining({ pedidoId: "p", cliente: { id: "c" }, servicoId: "corte", servicosAdicionais: ["barba"], origem: "SITE", inicio }), ator);
    expect(m.atualizar).not.toHaveBeenCalled(); // A aprovação pertence à transação de reservar.
  });
  it("a observação do cliente acompanha o horário aprovado para o barbeiro", async () => {
    m.pedido.mockResolvedValue({ ...pedido, observacao: "Prefiro manter o comprimento no topo." });
    await decidirPedido("p", ator, { ...previa, acao: "aprovar", barbeiroId: "b", inicio: new Date("2026-11-05T13:00Z"), conferido: true });
    expect(m.reservar).toHaveBeenCalledWith(expect.objectContaining({ observacao: "Prefiro manter o comprimento no topo." }), ator);
  });
  it("falha na reserva não aprova o pedido", async () => {
    m.pedido.mockResolvedValue(pedido); m.reservar.mockRejectedValueOnce(new Error("conflito"));
    await expect(decidirPedido("p", ator, { ...previa, acao: "aprovar", barbeiroId: "b", inicio: new Date("2026-11-05T13:00Z"), conferido: true })).rejects.toThrow("conflito");
    expect(m.atualizar).not.toHaveBeenCalled();
  });
  it("a chave idempotente não pode mascarar uma aprovação com horário diferente", async () => {
    m.pedido.mockResolvedValue({ ...pedido, status: "APROVADO", agendamentoIds: ["ag"] });
    m.agendamento.mockResolvedValue({ id: "ag", barbeiroId: "b", inicio: new Date("2026-11-05T13:00Z") });
    await expect(decidirPedido("p", ator, { ...previa, acao: "aprovar", barbeiroId: "b", inicio: new Date("2026-11-05T14:00Z"), conferido: true })).rejects.toMatchObject({ codigo: "pedido_decidido" });
    expect(m.reservar).not.toHaveBeenCalled();
  });
});

describe("trava da aprovação e validação de preferência", () => {
  it("aprovação envia preço/duração conferidos e aceite avulso explícito à reserva atômica", async () => {
    m.pedido.mockResolvedValue(pedido);
    await decidirPedido("p", ator, { ...previa, acao: "aprovar", barbeiroId: "b", inicio: new Date("2026-11-05T13:00Z"), conferido: true, forcarAvulso: true });
    expect(m.reservar).toHaveBeenCalledWith(expect.objectContaining({ ...previa, forcarAvulso: true }), ator);
  });
  it("não inventa aceite de pagamento avulso", async () => {
    m.pedido.mockResolvedValue(pedido);
    await decidirPedido("p", ator, { ...previa, acao: "aprovar", barbeiroId: "b", inicio: new Date("2026-11-05T13:00Z"), conferido: true });
    expect(m.reservar).toHaveBeenCalledWith(expect.objectContaining({ forcarAvulso: false }), ator);
  });
  const entrada = { clienteId: "c", barbeiroId: "b", servicoIds: ["corte", "barba"], inicio: new Date("2026-11-05T13:00Z") };
  it("revalida estado, profissional e serviços depois de travar o pedido", async () => {
    m.pedido.mockResolvedValue({ ...pedido, status: "CANCELADO" });
    await expect(validarPedidoReserva(tx, "p", ator, entrada)).rejects.toMatchObject({ codigo: "pedido_decidido" });
    m.pedido.mockResolvedValue(pedido);
    await expect(validarPedidoReserva(tx, "p", ator, { ...entrada, barbeiroId: "outro" })).rejects.toMatchObject({ codigo: "pedido_alterado" });
    await expect(validarPedidoReserva(tx, "p", ator, { ...entrada, servicoIds: ["corte"] })).rejects.toMatchObject({ codigo: "pedido_alterado" });
    expect(m.trava).toHaveBeenCalledTimes(3);
  });
  it("replay exato retorna a reserva existente sem recriar", async () => {
    m.pedido.mockResolvedValue({ ...pedido, status: "APROVADO", agendamentoIds: ["ag"] });
    const ag = { id: "ag", barbeiroId: "b", inicio: entrada.inicio }; m.agendamento.mockResolvedValue(ag);
    await expect(validarPedidoReserva(tx, "p", ator, entrada)).resolves.toEqual(ag);
    expect(m.criar).not.toHaveBeenCalled();
  });
  it("conclui e audita usando a mesma transação e todos os IDs", async () => {
    await concluirPedido(tx, "p", "u", ["ag1", "ag2"]);
    expect(m.atualizar).toHaveBeenCalledWith({ where: { id: "p" }, data: expect.objectContaining({ status: "APROVADO", agendamentoIds: ["ag1", "ag2"], decididoPorId: "u" }) });
    expect(m.auditar).toHaveBeenCalledWith(tx, "u", "aprovar_pedido_agendamento", "pedido_agendamento", "p", expect.objectContaining({ agendaExternaConferida: true }));
  });
  it("rejeita data impossível, serviço repetido e mais de dez serviços", () => {
    expect(entradaPedido.safeParse({ ...p, dataPreferida: "2026-02-31" }).success).toBe(false);
    expect(entradaPedido.safeParse({ ...p, servicoIds: ["corte", "corte"] }).success).toBe(false);
    expect(entradaPedido.safeParse({ ...p, servicoIds: Array.from({ length: 11 }, (_, i) => `s${i}`) }).success).toBe(false);
  });
  it("aplica janela e antecedência no fuso de São Paulo", () => {
    expect(() => validarPreferencia({ dataPreferida: "2026-11-04", horaPreferida: "09:15" }, cfg)).toThrow();
    expect(() => validarPreferencia({ dataPreferida: "2026-12-05", horaPreferida: "10:00" }, cfg)).toThrow();
    expect(() => validarPreferencia(p, cfg)).not.toThrow();
    expect(mesmoPedido({ ...p, observacao: null }, p)).toBe(true);
  });
});
