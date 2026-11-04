import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  piloto: vi.fn(), transporte: vi.fn(), configuracao: vi.fn(), assinaturas: vi.fn(),
  entrada: vi.fn(), entrevista: vi.fn(), mensagem: vi.fn(), modelo: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  assinatura: { findMany: mocks.assinaturas },
  $transaction: vi.fn(),
} }));
vi.mock("@/lib/whatsapp/piloto", () => ({ reservarEnvioPiloto: mocks.piloto, estadoPiloto: mocks.piloto }));
vi.mock("@/lib/whatsapp/evolution", () => ({ enviarTextoEvolution: mocks.transporte }));
vi.mock("@/lib/whatsapp/conversas", () => ({ registrarEntrada: mocks.entrada, enviarNaConversa: mocks.mensagem, notificarEmSegundoPlano: vi.fn() }));
vi.mock("@/lib/bot/entrevistas", () => ({ processarBotEntrevista: mocks.entrevista, registroSeguroEntrevista: (s: string) => s, contemConviteEntrevista: () => false, comandoReservadoEntrevista: () => false }));
vi.mock("@/lib/bot/agente", () => ({ executarTurno: mocks.modelo }));
vi.mock("@/lib/agenda/carregar", () => ({ configuracao: mocks.configuracao }));

import { enviarCodigoAcesso, enviarTemplate, enviarTexto } from "@/lib/whatsapp/canal";
import { receberMensagem } from "@/lib/bot/processar";
import { gerarPixDoProximoMes } from "@/lib/assinaturas/rotina";
import { agendarAutomacoes, rodarAutomacoes } from "@/lib/automacoes/rotina";

const telefone = "5547999990000";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AMBIENTE", "producao");
  vi.stubEnv("WHATSAPP_PROVIDER", "evolution");
  vi.stubEnv("WHATSAPP_ENVIOS_BLOQUEADOS", "true");
  vi.stubEnv("WHATSAPP_PILOTO_ENTREVISTAS_HABILITADO", "true");
  vi.stubEnv("PAGAMENTOS_EMISSAO_AUTOMATICA_PIX_ATIVA", "false");
  mocks.piloto.mockResolvedValue({ ativo: true, telefone, expiraEm: new Date(Date.now() + 60_000), enviados: 0, versao: 1 });
  mocks.transporte.mockResolvedValue({ wamid: "fixture" });
  mocks.entrada.mockResolvedValue({ id: "conversa", telefone, estado: "BOT" });
  mocks.configuracao.mockResolvedValue({ fuso: "America/Sao_Paulo" });
  mocks.assinaturas.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());

describe("publicação com envios e gastos desativados", () => {
  it("não envia mensagens nem templates mesmo com piloto ativo e número autorizado", async () => {
    await expect(enviarTexto(telefone, "teste", 0, "ENTREVISTA_PILOTO")).rejects.toThrow("bloqueados");
    await expect(enviarTemplate(telefone, { nome: "teste", parametros: [] })).rejects.toThrow("bloqueados");
    expect(mocks.piloto).not.toHaveBeenCalled();
    expect(mocks.transporte).not.toHaveBeenCalled();
  });
  it("preserva código de acesso solicitado sem permitir conteúdo arbitrário", async () => {
    await enviarCodigoAcesso(telefone, "123456");
    expect(mocks.transporte).toHaveBeenCalledTimes(1);
    await expect(enviarCodigoAcesso(telefone, "oferta")).rejects.toThrow("inválido");
    expect(mocks.transporte).toHaveBeenCalledTimes(1);
  });
  it("persiste PARAR mas não processa entrevista, envia ou chama IA", async () => {
    await receberMensagem({ telefone, texto: "PARAR" });
    expect(mocks.entrada).toHaveBeenCalledWith(expect.objectContaining({ telefone, optOut: true }));
    expect(mocks.piloto).not.toHaveBeenCalled();
    expect(mocks.entrevista).not.toHaveBeenCalled();
    expect(mocks.mensagem).not.toHaveBeenCalled();
    expect(mocks.modelo).not.toHaveBeenCalled();
  });
  it("não consulta clientes para emitir Pix automaticamente", async () => {
    expect(await gerarPixDoProximoMes()).toBe(0);
    expect(mocks.configuracao).not.toHaveBeenCalled();
    expect(mocks.assinaturas).not.toHaveBeenCalled();
  });
  it("não processa fila nem checklist enquanto envios estão bloqueados", async () => {
    vi.useFakeTimers();
    try {
      expect(Object.values(await rodarAutomacoes()).every((x) => x === 0)).toBe(true);
      agendarAutomacoes();
      await vi.advanceTimersByTimeAsync(46_000);
      expect(mocks.configuracao).not.toHaveBeenCalled();
      expect(mocks.transporte).not.toHaveBeenCalled();
    } finally {
      delete (globalThis as { rotinaAutomacoes?: boolean }).rotinaAutomacoes;
      vi.useRealTimers();
    }
  });
  it("quando a flag de emissão não está configurada preserva a rotina legada", async () => {
    vi.stubEnv("PAGAMENTOS_EMISSAO_AUTOMATICA_PIX_ATIVA", "");
    expect(await gerarPixDoProximoMes()).toBe(0);
    expect(mocks.configuracao).toHaveBeenCalledTimes(1);
    expect(mocks.assinaturas).toHaveBeenCalledTimes(1);
  });
});
