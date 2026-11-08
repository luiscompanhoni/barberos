import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ campanhas: vi.fn(), fila: vi.fn(), count: vi.fn(), reservar: vi.fn(), salvar: vi.fn(), marcou: vi.fn(), enviar: vi.fn(), contato: vi.fn(), recente: vi.fn() }));
vi.mock("@/lib/db", () => {
  const tx = { $queryRaw: vi.fn(), cliente: { findUnique: m.contato }, campanha: { findMany: m.campanhas }, campanhaEnvio: { findMany: m.fila, findFirst: m.recente, count: m.count, updateMany: m.reservar, update: m.salvar }, agendamento: { count: m.marcou } };
  return { db: { ...tx, $transaction: (fn: (p: typeof tx) => unknown) => fn(tx) } };
});
vi.mock("@/lib/whatsapp/piloto-regras", () => ({ recursoPiloto: () => false }));
vi.mock("@/lib/agenda/carregar", () => ({ configuracao: async () => ({ fuso: "America/Sao_Paulo", nomeBarbearia: "Black" }) }));
vi.mock("@/lib/whatsapp/conversas", () => ({ notificarCliente: m.enviar }));
vi.mock("@/lib/jogos/motor", () => ({ noAr: () => true }));
vi.mock("@/lib/dominios", () => ({ urlSite: () => "https://cliente.example.test" }));
import { processarCampanhas } from "@/lib/campanhas/servico";
const cliente = { nome: "Teste", telefone: "telefone-ficticio", aceitaMensagens: true, excluidoEm: null, conversa: { estado: "BOT", recusaAutomaticas: false } };
beforeEach(() => {
  vi.clearAllMocks(); m.campanhas.mockResolvedValue([{ id: "c", limiteDiario: 5, mensagem: "Oi {nome}, {link}" }]);
  m.count.mockResolvedValue(0); m.marcou.mockResolvedValue(0); m.reservar.mockResolvedValue({ count: 1 }); m.enviar.mockResolvedValue({ mensagemId: "m" });
  m.contato.mockResolvedValue(cliente); m.recente.mockResolvedValue(null);
});
describe("campanha reavalia o contato antes de despachar", () => {
  it.each([
    { ...cliente, aceitaMensagens: false },
    { ...cliente, excluidoEm: new Date() },
    { ...cliente, conversa: { estado: "BOT", recusaAutomaticas: true } },
    { ...cliente, conversa: { estado: "HUMANO", recusaAutomaticas: false } },
    { ...cliente, assinaturas: [{ migracao: { estado: "ADIADO" } }] },
  ])("não chama contato impedido desde a liberação do lote", async c => {
    m.fila.mockResolvedValue([{ id: "e", clienteId: "proprio", token: "teste", cliente: c }]);
    m.contato.mockResolvedValue(c);
    expect(await processarCampanhas()).toBe(0); expect(m.enviar).not.toHaveBeenCalled();
    expect(m.reservar.mock.calls[0][0].data.status).toBe("PULADO");
  });
  it("mantém o envio do convite autorizado e registra a mensagem", async () => {
    m.fila.mockResolvedValue([{ id: "e", clienteId: "proprio", token: "teste", cliente }]);
    expect(await processarCampanhas()).toBe(1); expect(m.enviar).toHaveBeenCalledTimes(1);
    expect(m.enviar.mock.calls[0][1]).toContain("PARAR");
    expect(m.salvar).toHaveBeenCalledWith({ where: { id: "e" }, data: { mensagemId: "m" } });
  });
  it("aguarda 48 horas entre campanhas sem descartar o destinatário", async () => {
    m.fila.mockResolvedValue([{ id: "e", clienteId: "proprio", token: "teste", cliente }]);
    m.recente.mockResolvedValue({ id: "outra-campanha" });
    expect(await processarCampanhas()).toBe(0);
    expect(m.reservar).not.toHaveBeenCalled(); expect(m.enviar).not.toHaveBeenCalled();
  });
  it("usa o telefone atual e não o capturado quando entrou na fila", async () => {
    m.fila.mockResolvedValue([{ id: "e", clienteId: "proprio", token: "teste", cliente: { ...cliente, telefone: "numero-antigo" } }]);
    expect(await processarCampanhas()).toBe(1);
    expect(m.enviar.mock.calls[0][0]).toBe(cliente.telefone);
  });
  it("não repete envio se outra rodada já reservou a mesma linha", async () => {
    m.fila.mockResolvedValue([{ id: "e", clienteId: "proprio", token: "teste", cliente }]);
    m.reservar.mockResolvedValue({ count: 0 });
    expect(await processarCampanhas()).toBe(0); expect(m.enviar).not.toHaveBeenCalled();
  });
});
