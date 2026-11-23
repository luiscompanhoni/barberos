import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  enviar: vi.fn(), lote: vi.fn(), template: vi.fn(), janela: vi.fn(),
  mensagem: vi.fn(), conversa: vi.fn(), cliente: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { conversa: { findUniqueOrThrow: m.conversa }, cliente: { findUnique: m.cliente }, mensagem: { create: m.mensagem } } }));
vi.mock("@/lib/eventos", () => ({ publicar: vi.fn() }));
vi.mock("@/lib/whatsapp/canal", () => ({
  enviarTexto: m.enviar, enviarTextoLoteAutorizado: m.lote,
  enviarTemplate: m.template, temJanela24h: m.janela, dentroJanela24h: () => false,
}));
import { enviarNaConversa } from "@/lib/whatsapp/conversas";

beforeEach(() => {
  vi.clearAllMocks();
  m.conversa.mockResolvedValue({ telefone: "5547999990000", waId: null, estado: "BOT" });
  m.cliente.mockResolvedValue(null);
  m.mensagem.mockResolvedValue({ id: "mensagem" });
  m.enviar.mockResolvedValue({ wamid: "simulado" });
  m.lote.mockResolvedValue({ wamid: "lote" });
  m.template.mockResolvedValue({ wamid: "template" });
  m.janela.mockReturnValue(false);
});

describe("origem interna do envio de conversa", () => {
  it("preserva a origem e registra o envio do texto de convite com prévia", async () => {
    const texto = "https://black.example/c/r/rotf_chave";
    const resultado = await enviarNaConversa("c", texto, "BOT", {
      conviteIndividual: true, pararSeHumano: true, digitandoMs: 1200, previaRoleta: true,
    });
    expect(m.enviar).toHaveBeenCalledExactlyOnceWith("5547999990000", texto, 1200, "CONVITE_APP", true);
    expect(m.mensagem).toHaveBeenCalledExactlyOnceWith({
      data: { conversaId: "c", autor: "BOT", texto, wamid: "simulado", erro: null },
    });
    expect(resultado).toEqual({ ok: true, erro: null, mensagemId: "mensagem", wamid: "simulado" });
  });

  it("identifica confirmação do gateway como finalidade transacional", async () => {
    await enviarNaConversa("c", "Pagamento confirmado.", "SISTEMA", { pagamentoConfirmado: true });
    expect(m.enviar.mock.calls[0][3]).toBe("PAGAMENTO_CONFIRMADO");
  });
  it("marca somente respostas da equipe e bot identificado como atendimento", async () => {
    await enviarNaConversa("c", "oi", "EQUIPE");
    await enviarNaConversa("c", "oi", "BOT", { respostaAtendimento: true });
    await enviarNaConversa("c", "oi", "SISTEMA", { respostaAtendimento: true });
    await enviarNaConversa("c", "oi", "BOT");
    expect(m.enviar.mock.calls.map(c => c[3])).toEqual(["ATENDIMENTO", "ATENDIMENTO", "PADRAO", "PADRAO"]);
  });
  it("prioriza a origem de entrevista quando explicitamente informada", async () => {
    await enviarNaConversa("c", "oi", "BOT", { entrevistaPiloto: true, respostaAtendimento: true });
    expect(m.enviar.mock.calls[0][3]).toBe("ENTREVISTA_PILOTO");
  });
  it("bloqueia envio automático após recusa sem impedir resposta humana", async () => {
    m.conversa.mockResolvedValue({ telefone: "5547999990000", waId: null, recusaAutomaticas: true });
    const bloqueado = await enviarNaConversa("c", "novidade", "SISTEMA");
    expect(bloqueado.ok).toBe(false);
    expect(m.enviar).not.toHaveBeenCalled();
    const humano = await enviarNaConversa("c", "resposta", "EQUIPE");
    expect(humano.ok).toBe(true);
    expect(m.enviar).toHaveBeenCalledTimes(1);
  });
  it("também respeita recusa legada do cliente sem registro anterior na conversa", async () => {
    m.cliente.mockResolvedValue({ aceitaMensagens: false });
    const resultado = await enviarNaConversa("c", "novidade", "SISTEMA");
    expect(resultado.ok).toBe(false);
    expect(m.enviar).not.toHaveBeenCalled();
  });

  it("respeita a recusa do cliente com prévia solicitada no convite", async () => {
    m.cliente.mockResolvedValue({ aceitaMensagens: false });
    const resultado = await enviarNaConversa("c", "https://black.example", "BOT", {
      conviteIndividual: true, pararSeHumano: true, previaRoleta: true,
    });
    expect(resultado).toMatchObject({ ok: false, erro: "O contato pediu para não receber mensagens automáticas.", wamid: null });
    expect(m.enviar).not.toHaveBeenCalled();
  });

  it("mantém os argumentos do lote autorizado e do template ao receber a opção de prévia", async () => {
    const conversa = { telefone: "5547999990000", waId: null, estado: "BOT" };
    m.conversa.mockResolvedValue(conversa);
    const template = { nome: "campanha", parametros: [] };
    await expect(enviarNaConversa("c", "abertura", "SISTEMA", {
      aberturaLote: { envioId: "envio", etapa: 0 }, previaRoleta: true,
    })).resolves.toMatchObject({ ok: true, wamid: "lote" });
    m.janela.mockReturnValue(true);
    await expect(enviarNaConversa("c", "campanha", "SISTEMA", {
      campanha: true, templateAberturaCampanha: template, previaRoleta: true,
    })).resolves.toMatchObject({ ok: true, wamid: "template" });
    expect(m.lote).toHaveBeenCalledExactlyOnceWith("envio", conversa, "abertura", 0);
    expect(m.template).toHaveBeenCalledExactlyOnceWith(conversa.telefone, template, "CAMPANHA");
    expect(m.enviar).not.toHaveBeenCalled();
  });

  it("mantém conversas do Instagram no Direct mesmo com prévia solicitada", async () => {
    m.conversa.mockResolvedValue({ instagramIgsid: "perfil" });
    await expect(enviarNaConversa("c", "https://black.example", "EQUIPE", { previaRoleta: true }))
      .rejects.toThrow("Use o canal Instagram Direct");
    expect(m.enviar).not.toHaveBeenCalled();
  });
});
