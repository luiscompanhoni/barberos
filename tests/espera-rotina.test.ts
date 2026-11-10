import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { processarEsperas } from "@/lib/crescimento/rotina";
import { ErroNegocio } from "@/lib/erros";

const m = vi.hoisted(() => ({ pedidos: vi.fn(), atualizar: vi.fn(), contar: vi.fn(), perto: vi.fn(), servicos: vi.fn(),
  enviar: vi.fn(), opcoes: vi.fn(), auditar: vi.fn(), quarentena: vi.fn(), piloto: vi.fn(), teste: vi.fn(), travar: vi.fn(), cliente: vi.fn() }));
vi.mock("@/lib/db", () => {
  const tx = { $executeRaw: m.travar, esperaHorario: { findMany: m.pedidos, updateMany: m.atualizar, count: m.contar },
    agendamento: { findMany: m.perto }, servico: { findMany: m.servicos }, cliente: { findUnique: m.cliente } };
  return { db: { ...tx, $transaction: async (f: (c: typeof tx) => unknown) => f(tx) } };
});
vi.mock("@/lib/agenda/carregar", () => ({ configuracao: async () => ({ fuso: "America/Sao_Paulo" }) }));
vi.mock("@/lib/crescimento/espera", () => ({ opcoesDoDia: m.opcoes, descreverOpcao: () => "14:00 com Profissional" }));
vi.mock("@/lib/crescimento/indicacao", () => ({ converterIndicacoes: vi.fn() }));
vi.mock("@/lib/automacoes/enviar", () => ({ enviarAutomacao: m.enviar }));
vi.mock("@/lib/auditoria", () => ({ auditar: m.auditar }));
vi.mock("@/lib/recuperacao/quarentena", () => ({ quarentenaRestauracao: m.quarentena }));
vi.mock("@/lib/whatsapp/piloto-regras", () => ({ recursoPiloto: m.piloto }));
vi.mock("@/lib/whatsapp/teste-equipe", () => ({ testeEquipeAtivo: m.teste }));
const agora = Date.parse("2026-11-10T14:00:00Z");
const pedido = { id: "espera", clienteId: "cliente", data: new Date("2026-11-11T00:00:00Z"), servicoId: "barba", servicosAdicionais: ["corte"], barbeiroId: "b", periodo: "TARDE", origem: "SITE", cliente: { nome: "Fictício", telefone: "5500000000000" } };

describe("rotina dos pedidos de aviso", () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv("WHATSAPP_ENVIOS_BLOQUEADOS", "false");
    m.quarentena.mockReturnValue(false); m.piloto.mockReturnValue(false); m.teste.mockReturnValue(false);
    m.cliente.mockResolvedValue({ id: "cliente", excluidoEm: null });
    m.pedidos.mockResolvedValue([pedido]); m.perto.mockResolvedValue([]); m.atualizar.mockResolvedValue({ count: 1 });
    m.contar.mockImplementation(async q => q.where.id ? 1 : 0);
    m.servicos.mockResolvedValue([{ nome: "Barba" }, { nome: "Corte" }]); m.enviar.mockResolvedValue(false);
    m.opcoes.mockResolvedValue([{ barbeiroId: "b", nome: "Profissional", inicio: "2026-11-11T17:00:00Z", minutos: 840 }]);
  });
  afterEach(() => vi.unstubAllEnvs());
  it.each(["envios", "quarentena", "piloto", "teste"])("%s bloqueado não consome chave nem altera o pedido", async bloqueio => {
    if (bloqueio === "envios") vi.stubEnv("WHATSAPP_ENVIOS_BLOQUEADOS", "true");
    else m[bloqueio as "quarentena" | "piloto" | "teste"].mockReturnValue(true);
    expect(await processarEsperas(agora)).toBe(0);
    expect(m.pedidos).not.toHaveBeenCalled(); expect(m.atualizar).not.toHaveBeenCalled(); expect(m.enviar).not.toHaveBeenCalled();
  });
  it("falha do canal mantém ATIVA, sem auditar falso aviso", async () => {
    expect(await processarEsperas(agora)).toBe(0);
    expect(m.opcoes).toHaveBeenCalledWith("2026-11-11", "barba", "b", "TARDE", ["corte"], { esperaId: "espera" });
    expect(m.atualizar.mock.calls.some(([q]) => q.data.status === "AVISADA")).toBe(false);
    expect(m.auditar).not.toHaveBeenCalled();
  });
  it("confirmação do canal marca AVISADA e audita sem reservar horário", async () => {
    m.enviar.mockResolvedValue(true);
    expect(await processarEsperas(agora)).toBe(1);
    expect(m.atualizar).toHaveBeenCalledWith({ where: { id: "espera", status: "ATIVA" }, data: { status: "AVISADA", avisadaEm: new Date(agora) } });
    expect(m.auditar).toHaveBeenCalledWith(expect.anything(), null, "avisar", "espera_horario", "espera", { clienteId: "cliente" });
    expect(m.enviar.mock.calls[0][0].texto).toContain("Barba + Corte");
  });
  it("não reutiliza a exceção SITE em uma espera do BOT legado", async () => {
    m.pedidos.mockResolvedValue([pedido, { ...pedido, id: "espera-bot", origem: "BOT" }]);
    m.enviar.mockResolvedValue(true);
    m.opcoes.mockImplementation(async (...args) => {
      if (!args[5].esperaId) throw new ErroNegocio("Fonte externa", 409, "confirmacao_equipe");
      return [{ barbeiroId: "b", nome: "Profissional", inicio: "2026-11-11T17:00:00Z", minutos: 840 }];
    });
    expect(await processarEsperas(agora)).toBe(1);
    expect(m.opcoes).toHaveBeenCalledTimes(2); expect(m.enviar).toHaveBeenCalledOnce();
  });
  it("cancelamento ou recusa entre consulta e claim impede o envio", async () => {
    m.contar.mockResolvedValue(0);
    expect(await processarEsperas(agora)).toBe(0);
    expect(m.enviar).not.toHaveBeenCalled();
  });
  it("cliente excluído durante a rodada é ignorado sem impedir o próximo aviso", async () => {
    m.pedidos.mockResolvedValue([pedido, { ...pedido, id: "outra-espera", clienteId: "outro-cliente" }]);
    m.cliente.mockResolvedValueOnce({ id: "cliente", excluidoEm: new Date() });
    m.enviar.mockResolvedValue(true);
    expect(await processarEsperas(agora)).toBe(1);
    expect(m.enviar).toHaveBeenCalledOnce();
    expect(m.enviar).toHaveBeenCalledWith(expect.objectContaining({ chave: "outra-espera", clienteId: "outro-cliente" }));
  });
  it("corte isolado, dois atendimentos separados ou outro profissional não consomem aviso do conjunto", async () => {
    const principal = { id: "principal", adicionalDeId: null, barbeiroId: "b", servicoId: "corte", inicio: new Date("2026-11-11T17:00:00Z") };
    const barba = { ...principal, id: "barba", servicoId: "barba", adicionalDeId: "principal" };
    m.enviar.mockResolvedValue(true);
    for (const atendimentos of [[principal], [principal, { ...barba, adicionalDeId: null }], [principal, { ...barba, barbeiroId: "outro" }]]) {
      m.perto.mockResolvedValue(atendimentos);
      expect(await processarEsperas(agora)).toBe(1);
    }
    expect(m.atualizar.mock.calls.some(([q]) => q.data.status === "ATENDIDA")).toBe(false);
  });
  it("um atendimento com todos os serviços e o profissional escolhido encerra o aviso sem envio", async () => {
    m.perto.mockResolvedValue([
      { id: "principal", adicionalDeId: null, barbeiroId: "b", servicoId: "corte", inicio: new Date("2026-11-11T17:00:00Z") },
      { id: "barba", adicionalDeId: "principal", barbeiroId: "b", servicoId: "barba", inicio: new Date("2026-11-11T17:30:00Z") },
    ]);
    expect(await processarEsperas(agora)).toBe(0);
    expect(m.atualizar).toHaveBeenCalledWith({ where: { id: "espera", status: "ATIVA" }, data: { status: "ATENDIDA" } });
    expect(m.enviar).not.toHaveBeenCalled();
    expect(m.auditar).toHaveBeenCalledWith(expect.anything(), null, "atender", "espera_horario", "espera", { clienteId: "cliente" });
  });
  it("atendimento de manhã não encerra um pedido para a noite do mesmo dia", async () => {
    m.pedidos.mockResolvedValue([{ ...pedido, periodo: "NOITE" }]);
    m.perto.mockResolvedValue([
      { id: "principal", adicionalDeId: null, barbeiroId: "b", servicoId: "corte", inicio: new Date("2026-11-11T12:00:00Z") },
      { id: "barba", adicionalDeId: "principal", barbeiroId: "b", servicoId: "barba", inicio: new Date("2026-11-11T12:40:00Z") },
    ]);
    m.enviar.mockResolvedValue(true);
    expect(await processarEsperas(agora)).toBe(1);
    expect(m.atualizar.mock.calls.some(([q]) => q.data.status === "ATENDIDA")).toBe(false);
    expect(m.enviar).toHaveBeenCalledOnce();
  });
  it("o início do principal define a manhã mesmo que o adicional comece depois do meio-dia", async () => {
    m.pedidos.mockResolvedValue([{ ...pedido, periodo: "MANHA" }]);
    m.perto.mockResolvedValue([
      { id: "principal", adicionalDeId: null, barbeiroId: "b", servicoId: "corte", inicio: new Date("2026-11-11T14:50:00Z") },
      { id: "barba", adicionalDeId: "principal", barbeiroId: "b", servicoId: "barba", inicio: new Date("2026-11-11T15:10:00Z") },
    ]);
    expect(await processarEsperas(agora)).toBe(0);
    expect(m.atualizar).toHaveBeenCalledWith({ where: { id: "espera", status: "ATIVA" }, data: { status: "ATENDIDA" } });
    expect(m.enviar).not.toHaveBeenCalled();
  });
  it("não presume o período de um conjunto sem o atendimento principal na consulta", async () => {
    m.perto.mockResolvedValue([
      { id: "corte", adicionalDeId: "principal-ausente", barbeiroId: "b", servicoId: "corte", inicio: new Date("2026-11-11T17:00:00Z") },
      { id: "barba", adicionalDeId: "principal-ausente", barbeiroId: "b", servicoId: "barba", inicio: new Date("2026-11-11T17:30:00Z") },
    ]);
    m.enviar.mockResolvedValue(true);
    expect(await processarEsperas(agora)).toBe(1);
    expect(m.atualizar.mock.calls.some(([q]) => q.data.status === "ATENDIDA")).toBe(false);
  });
});
