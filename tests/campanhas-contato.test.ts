import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversa } from "@prisma/client";
const m = vi.hoisted(() => ({
  campanhas: vi.fn(), campanha: vi.fn(), fila: vi.fn(), count: vi.fn(), reservar: vi.fn(), salvar: vi.fn(),
  marcou: vi.fn(), visita: vi.fn(), enviar: vi.fn(), contato: vi.fn(), recente: vi.fn(), conversa: vi.fn(), canal: vi.fn(),
  preferencia: vi.fn(), ultimaSaida: vi.fn(), envioAtual: vi.fn(),
}));
vi.mock("@/lib/db", () => {
  const tx = { $queryRaw: vi.fn(), $executeRaw: vi.fn(), cliente: { findUnique: m.contato },
    campanha: { findMany: m.campanhas, findUnique: m.campanha },
    campanhaEnvio: { findMany: m.fila, findFirst: m.recente, findUnique: m.envioAtual, count: m.count, updateMany: m.reservar, update: m.salvar },
    mensagem: { findFirst: m.ultimaSaida },
    agendamento: { count: m.marcou, aggregate: m.visita } };
  return { db: { ...tx, $transaction: (fn: (p: typeof tx) => unknown) => fn(tx) } };
});
vi.mock("@/lib/whatsapp/piloto-regras", () => ({ recursoPiloto: () => false }));
vi.mock("@/lib/agenda/carregar", () => ({ configuracao: async () => ({ fuso: "America/Sao_Paulo", nomeBarbearia: "Black" }) }));
vi.mock("@/lib/whatsapp/conversas", () => ({ enviarNaConversa: m.enviar, obterConversa: m.conversa }));
vi.mock("@/lib/whatsapp/preferencia", () => ({ travarPreferencia: m.preferencia }));
vi.mock("@/lib/whatsapp/canal", async original => ({
  ...await original<typeof import("@/lib/whatsapp/canal")>(),
  temJanela24h: () => m.canal() === "cloud",
  provedorWhatsApp: m.canal,
}));
vi.mock("node:timers/promises", () => ({ setTimeout: vi.fn() }));
vi.mock("@/lib/jogos/motor", () => ({ noAr: (j: { ativo: boolean }) => j.ativo, premiosExibiveis: async (lista: unknown[]) => lista }));
vi.mock("@/lib/dominios", () => ({ urlSite: () => "https://cliente.example.test" }));
import { processarCampanhas } from "@/lib/campanhas/servico";
import { continuarCampanha } from "@/lib/campanhas/continuacao";
const agora = new Date("2026-11-19T14:00:00Z");
const conversa = { id: "conversa", telefone: "telefone-ficticio", clienteId: "proprio", ultimaEntradaEm: agora, estado: "BOT", recusaAutomaticas: false } as Conversa;
const cliente = { nome: "Teste Sobrenome", telefone: conversa.telefone, aceitaMensagens: true, excluidoEm: null, conversa, agendamentos: [] };
const envio = { id: "e", campanhaId: "c", clienteId: "proprio", token: "teste" };
const campanha = { id: "c", limiteDiario: 5, status: "ATIVA", mensagem: "Oi {nome}, {link}", jogo: null };
beforeEach(() => {
  vi.clearAllMocks(); m.campanhas.mockResolvedValue([campanha]);
  m.campanha.mockResolvedValue(campanha);
  vi.useFakeTimers({ now: agora });
  m.canal.mockReturnValue("simulador");
  m.count.mockResolvedValue(0); m.marcou.mockResolvedValue(0); m.visita.mockResolvedValue({ _max: { inicio: null } });
  m.reservar.mockResolvedValue({ count: 1 }); m.enviar.mockResolvedValue({ ok: true, mensagemId: "m" });
  m.conversa.mockResolvedValue({ id: "conversa", clienteId: envio.clienteId, ultimaEntradaEm: null });
  m.fila.mockResolvedValue([envio]);
  m.contato.mockResolvedValue(cliente); m.recente.mockResolvedValue(null);
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("campanha reavalia o contato antes de despachar", () => {
  it.each([
    { ...cliente, aceitaMensagens: false },
    { ...cliente, excluidoEm: new Date() },
    { ...cliente, conversa: { estado: "BOT", recusaAutomaticas: true } },
    { ...cliente, conversa: { estado: "HUMANO", recusaAutomaticas: false } },
    { ...cliente, assinaturas: [{ migracao: { estado: "ADIADO" } }] },
  ])("não chama contato impedido desde a liberação do lote", async c => {
    m.contato.mockResolvedValue(c);
    expect(await processarCampanhas()).toBe(0); expect(m.enviar).not.toHaveBeenCalled();
    expect(m.reservar.mock.calls[0][0].data.status).toBe("PULADO");
  });
  it("reserva o texto da oferta e registra dois balões limpos na abertura", async () => {
    const sucesso = new Date("2026-11-19T14:00:03Z");
    m.enviar.mockImplementationOnce(async () => {
      vi.setSystemTime(sucesso);
      return { ok: true, mensagemId: "m" };
    });
    expect(await processarCampanhas()).toBe(1); expect(m.enviar).toHaveBeenCalledTimes(2);
    expect(m.reservar.mock.calls[0][0].data).toMatchObject({ enviadoEm: agora, ofertaTexto: expect.stringContaining("/c/r/teste") });
    expect(m.enviar.mock.calls.map(c => c[1])).toEqual(["Fala, Teste!", "Aqui é o Leonel da Black."]);
    expect(m.salvar).toHaveBeenCalledWith({ where: { id: "e" }, data: { mensagemId: "m", enviadoEm: sucesso, aberturaConcluidaEm: sucesso } });
  });
  it("aguarda 48 horas entre campanhas sem descartar o destinatário", async () => {
    m.recente.mockResolvedValue({ id: "outra-campanha" });
    expect(await processarCampanhas()).toBe(0);
    expect(m.reservar).not.toHaveBeenCalled(); expect(m.enviar).not.toHaveBeenCalled();
  });
  it("usa o telefone atual e não o capturado quando entrou na fila", async () => {
    m.fila.mockResolvedValue([{ ...envio, cliente: { ...cliente, telefone: "numero-antigo" } }]);
    expect(await processarCampanhas()).toBe(1);
    expect(m.conversa).toHaveBeenCalledWith(cliente.telefone);
  });
  it("opt-out depois do primeiro balão interrompe a abertura", async () => {
    m.enviar.mockImplementationOnce(async () => {
      expect(m.preferencia).toHaveBeenCalledExactlyOnceWith(expect.anything(), cliente.telefone);
      m.contato.mockResolvedValue({ ...cliente, aceitaMensagens: false });
      return { ok: true, mensagemId: "primeira" };
    });
    expect(await processarCampanhas()).toBe(1);
    expect(m.enviar.mock.calls.map(c => c[1])).toEqual(["Fala, Teste!"]);
    expect(m.preferencia).toHaveBeenCalledTimes(2);
    expect(m.salvar.mock.lastCall?.[0].data.status).toBe("FALHOU");
  });
  it("relê o SAIR sob trava antes de transmitir uma oferta que já foi reservada", async () => {
    const atual = { ...envio, cliente, campanha, status: "ENVIADO", mensagemId: "abertura", ofertaTexto: "Oferta: /c/r/teste", respostaEm: null };
    m.ultimaSaida.mockResolvedValue({ id: "abertura" });
    m.recente.mockResolvedValue(envio);
    m.envioAtual.mockResolvedValue(atual);
    m.reservar.mockImplementationOnce(async () => {
      m.envioAtual.mockResolvedValue({ ...atual, respostaEm: agora, cliente: { ...cliente, aceitaMensagens: false } });
      return { count: 1 };
    });
    expect(await continuarCampanha(conversa, "Pode mandar!", async () => true)).toBe("equipe");
    expect(m.preferencia).toHaveBeenCalledTimes(2);
    expect(m.enviar).not.toHaveBeenCalled();
  });
  it("não repete envio se outra rodada já reservou a mesma linha", async () => {
    m.reservar.mockResolvedValue({ count: 0 });
    expect(await processarCampanhas()).toBe(0); expect(m.enviar).not.toHaveBeenCalled();
  });
  it("não reserva contato se a campanha mudou para pausada após a leitura da fila", async () => {
    m.campanha.mockResolvedValue({ status: "PAUSADA", mensagem: campanha.mensagem });
    expect(await processarCampanhas()).toBe(0);
    expect(m.reservar).not.toHaveBeenCalled(); expect(m.enviar).not.toHaveBeenCalled();
  });
  it("bloqueio global impede tanto a leitura quanto o processamento da fila", async () => {
    vi.stubEnv("WHATSAPP_ENVIOS_BLOQUEADOS", "true");
    expect(await processarCampanhas()).toBe(0);
    expect(m.campanhas).not.toHaveBeenCalled(); expect(m.enviar).not.toHaveBeenCalled();
  });
  it.each([91, 181])("para visita há %i dias exige roleta válida, inclusive em público misto", async dias => {
    m.visita.mockResolvedValue({ _max: { inicio: new Date(+agora - dias * 86_400_000) } });
    expect(await processarCampanhas()).toBe(0);
    expect(m.reservar.mock.calls[0][0].data.erro).toContain("roleta");
    expect(m.enviar).not.toHaveBeenCalled();
    m.campanha.mockResolvedValue({ ...campanha, jogo: { tipo: "ROLETA", ativo: true, premios: [{ id: "1" }, { id: "2" }] } });
    expect(await processarCampanhas()).toBe(1);
    expect(m.enviar).toHaveBeenCalledTimes(2);
  });
  it("na Cloud usa os dois modelos distintos fora da janela e nenhum com janela aberta", async () => {
    m.canal.mockReturnValue("cloud"); m.enviar.mockResolvedValue({ ok: true, wamid: "simulado", mensagemId: "m" });
    vi.stubEnv("WHATSAPP_TEMPLATE_CAMPANHA_SAUDACAO", "campanha_ola");
    vi.stubEnv("WHATSAPP_TEMPLATE_CAMPANHA_APRESENTACAO", "");
    expect(await processarCampanhas()).toBe(1);
    expect(m.enviar).not.toHaveBeenCalled();
    expect(m.salvar.mock.lastCall?.[0].data.erro).toContain("dois modelos");
    vi.stubEnv("WHATSAPP_TEMPLATE_CAMPANHA_APRESENTACAO", "campanha_apresentacao");
    expect(await processarCampanhas()).toBe(1);
    expect(m.enviar.mock.calls.map(c => c[3].templateAberturaCampanha)).toEqual([
      { nome: "campanha_ola", parametros: ["Teste"] }, { nome: "campanha_apresentacao", parametros: [] },
    ]);
    m.enviar.mockClear();
    m.conversa.mockResolvedValue({ id: "conversa", clienteId: envio.clienteId, ultimaEntradaEm: agora });
    expect(await processarCampanhas()).toBe(1);
    expect(m.enviar.mock.calls.map(c => c[3].templateAberturaCampanha)).toEqual([undefined, undefined]);
  });
});
