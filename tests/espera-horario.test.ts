import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { entrarNaEspera, opcoesDoDia, sairDaEspera } from "@/lib/crescimento/espera";
import { schemaEsperaHorario } from "@/lib/crescimento/espera-schemas";

const m = vi.hoisted(() => ({
  disponibilidade: vi.fn(), servicos: vi.fn(), profissionais: vi.fn(), cliente: vi.fn(), iguais: vi.fn(),
  ativas: vi.fn(), criar: vi.fn(), executar: vi.fn(), cancelar: vi.fn(), obter: vi.fn(), auditar: vi.fn(), titular: vi.fn(), conversa: vi.fn(),
}));
vi.mock("@/lib/db", () => {
  const tx = { $executeRaw: m.executar, cliente: { findFirst: m.cliente }, conversa: { findUnique: m.conversa }, esperaHorario: { findMany: m.iguais, count: m.ativas,
    create: m.criar, updateMany: m.cancelar, findFirst: m.obter } };
  return { db: { ...tx, $transaction: async (f: (c: typeof tx) => unknown) => f(tx), servico: { count: m.servicos }, barbeiro: { count: m.profissionais } } };
});
vi.mock("@/lib/agenda/carregar", () => ({ configuracao: async () => ({ fuso: "America/Sao_Paulo", janelaAgendamentoDias: 30 }) }));
vi.mock("@/lib/agenda/consultas", () => ({ horariosDisponiveis: m.disponibilidade }));
vi.mock("@/lib/auditoria", () => ({ auditar: m.auditar }));
vi.mock("@/lib/agenda/cliente-identidade", () => ({ travarClienteAgenda: m.titular }));

const entrada = { data: "2026-11-11", servicoId: "corte", servicosAdicionais: ["barba"], barbeiroId: "profissional", periodo: "TARDE" as const, origem: "SITE" as const };
const app = { clienteId: "cliente", titular: { usuarioId: "usuario", sessaoVersao: 2 } };

describe("pedido de aviso de horário", () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-10T14:00:00Z"));
    m.disponibilidade.mockResolvedValue([]); m.servicos.mockResolvedValue(2); m.profissionais.mockResolvedValue(1);
    m.cliente.mockResolvedValue({ id: "cliente", telefone: "5500000000000", aceitaMensagens: true }); m.conversa.mockResolvedValue(null); m.iguais.mockResolvedValue([]); m.ativas.mockResolvedValue(0);
    m.criar.mockResolvedValue({ id: "espera" }); m.cancelar.mockResolvedValue({ count: 1 });
  });
  afterEach(() => vi.useRealTimers());

  it("valida datas reais, períodos e até dez serviços distintos", () => {
    const publica = { data: entrada.data, servicoId: entrada.servicoId, servicosAdicionais: entrada.servicosAdicionais, barbeiroId: entrada.barbeiroId, periodo: entrada.periodo };
    expect(schemaEsperaHorario.safeParse(publica).success).toBe(true);
    expect(schemaEsperaHorario.safeParse({ ...publica, data: "2026-02-31" }).success).toBe(false);
    expect(schemaEsperaHorario.safeParse({ ...publica, periodo: "MADRUGADA" }).success).toBe(false);
    expect(schemaEsperaHorario.safeParse({ ...publica, servicosAdicionais: ["corte"] }).success).toBe(false);
    expect(schemaEsperaHorario.safeParse({ ...publica, servicosAdicionais: Array.from({ length: 10 }, (_, n) => `s${n}`) }).success).toBe(false);
    expect(schemaEsperaHorario.safeParse({ ...publica, clienteId: "outra-pessoa" }).success).toBe(false);
  });
  it("preserva cliente autenticado, serviços completos, período e auditoria na transação", async () => {
    await entrarNaEspera("cliente", entrada, app);
    expect(m.titular).toHaveBeenCalledWith(expect.anything(), "cliente", app.titular);
    expect(m.disponibilidade).toHaveBeenCalledWith(expect.objectContaining({ servicoId: "barba", servicosAdicionais: ["corte"], app, paraCliente: true }));
    expect(m.criar).toHaveBeenCalledWith({ data: expect.objectContaining({ clienteId: "cliente", servicoId: "barba", servicosAdicionais: ["corte"], periodo: "TARDE", origem: "SITE" }) });
    expect(m.executar).toHaveBeenCalled();
    expect(m.auditar).toHaveBeenCalledWith(expect.anything(), "usuario", "criar", "espera_horario", "espera", expect.objectContaining({ servicos: ["barba", "corte"] }));
  });
  it("repetição com ordem invertida conserva o pedido existente", async () => {
    m.iguais.mockResolvedValue([{ id: "mesmo", servicoId: "corte", servicosAdicionais: ["barba"], barbeiroId: "profissional", periodo: "TARDE" }]);
    expect((await entrarNaEspera("cliente", { ...entrada, servicoId: "barba", servicosAdicionais: ["corte"] }, app)).id).toBe("mesmo");
    expect(m.criar).not.toHaveBeenCalled(); expect(m.auditar).not.toHaveBeenCalled();
  });
  it.each([{ aceita: false, recusa: false }, { aceita: true, recusa: true }])("respeita recusa de avisos antes de criar ou deduplicar: %j", async preferencia => {
    m.cliente.mockResolvedValue({ id: "cliente", telefone: "5500000000000", aceitaMensagens: preferencia.aceita });
    m.conversa.mockResolvedValue({ recusaAutomaticas: preferencia.recusa });
    m.iguais.mockResolvedValue([{ id: "antigo" }]);
    await expect(entrarNaEspera("cliente", entrada, app)).rejects.toMatchObject({ status: 422, codigo: "avisos_desativados",
      message: "Ative os avisos automáticos em Perfil > Meus dados para pedir este aviso." });
    expect(m.conversa).toHaveBeenCalledWith({ where: { telefone: "5500000000000" }, select: { recusaAutomaticas: true } });
    expect(m.iguais).not.toHaveBeenCalled(); expect(m.criar).not.toHaveBeenCalled(); expect(m.auditar).not.toHaveBeenCalled();
  });
  it("não confunde profissionais nem períodos diferentes", async () => {
    m.iguais.mockResolvedValue([{ id: "outro", servicoId: "corte", servicosAdicionais: ["barba"], barbeiroId: "outro", periodo: "MANHA" }]);
    await entrarNaEspera("cliente", entrada, app);
    expect(m.criar).toHaveBeenCalledOnce();
  });
  it("recusa sessão de outra pessoa, serviço inativo e profissional incompatível", async () => {
    await expect(entrarNaEspera("outra", entrada, app)).rejects.toMatchObject({ status: 403 });
    m.servicos.mockResolvedValueOnce(1);
    await expect(entrarNaEspera("cliente", entrada, app)).rejects.toMatchObject({ status: 404 });
    m.profissionais.mockResolvedValueOnce(0);
    await expect(entrarNaEspera("cliente", entrada, app)).rejects.toThrow("Nenhum profissional");
    expect(m.criar).not.toHaveBeenCalled();
  });
  it("limita pedidos ativos e recusa data passada ou além da janela", async () => {
    m.ativas.mockResolvedValue(3);
    await expect(entrarNaEspera("cliente", entrada, app)).rejects.toThrow("3 pedidos");
    await expect(entrarNaEspera("cliente", { ...entrada, data: "2026-11-09" }, app)).rejects.toThrow("já passou");
    await expect(entrarNaEspera("cliente", { ...entrada, data: "2026-12-15" }, app)).rejects.toThrow("30 dias");
  });
  it("filtra as opções no horário de São Paulo e não entra se já houver vaga no período", async () => {
    m.disponibilidade.mockResolvedValue([{ barbeiroId: "profissional", nome: "Nome", horarios: ["2026-11-11T14:45:00Z", "2026-11-11T15:00:00Z", "2026-11-11T21:00:00Z"] }]);
    const opcoes = await opcoesDoDia(entrada.data, "corte", null, "TARDE", ["barba"], { app });
    expect(opcoes.map(o => o.minutos)).toEqual([720]);
    await expect(entrarNaEspera("cliente", entrada, app)).rejects.toMatchObject({ codigo: "tem_vaga" });
    expect(m.criar).not.toHaveBeenCalled();
  });
  it("cancela só pedido do próprio cliente, com auditoria e sem apagar histórico", async () => {
    m.obter.mockResolvedValue({ status: "ATIVA" });
    await sairDaEspera("cliente", "espera", app);
    expect(m.cancelar).toHaveBeenCalledWith({ where: expect.objectContaining({ clienteId: "cliente", id: "espera" }), data: { status: "CANCELADA" } });
    expect(m.auditar).toHaveBeenCalledWith(expect.anything(), "usuario", "cancelar", "espera_horario", "espera", expect.anything());
    m.obter.mockResolvedValue(null);
    await expect(sairDaEspera("cliente", "de-outra-pessoa", app)).rejects.toMatchObject({ status: 404 });
  });
  it("recusa de mensagens não impede cancelar um pedido antigo", async () => {
    m.cliente.mockResolvedValue({ id: "cliente", telefone: "5500000000000", aceitaMensagens: false });
    m.conversa.mockResolvedValue({ recusaAutomaticas: true }); m.obter.mockResolvedValue({ status: "AVISADA" });
    await sairDaEspera("cliente", "antigo", app);
    expect(m.cancelar).toHaveBeenCalledWith({ where: expect.objectContaining({ id: "antigo", clienteId: "cliente" }), data: { status: "CANCELADA" } });
    expect(m.conversa).not.toHaveBeenCalled();
  });
});
