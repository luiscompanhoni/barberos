import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ entrada: vi.fn(), enviar: vi.fn(), modelo: vi.fn(), cfg: vi.fn(), piloto: vi.fn(), conversa: vi.fn(), carregar: vi.fn(), update: vi.fn(), mensagens: vi.fn(), equipe: vi.fn(), provedor: vi.fn(), depois: vi.fn() }));
vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: m.depois }));
vi.mock("@/lib/whatsapp/conversas", () => ({ registrarEntrada: m.entrada, enviarNaConversa: m.enviar }));
vi.mock("@/lib/whatsapp/canal", () => ({ provedorWhatsApp: m.provedor }));
vi.mock("@/lib/whatsapp/evolution", () => ({ tokenWebhookEvolution: () => "token-ficticio" }));
vi.mock("@/lib/whatsapp/status", () => ({ registrarStatus: vi.fn(async () => {}) }));
vi.mock("@/lib/bot/agente", () => ({ executarTurno: m.modelo }));
vi.mock("@/lib/agenda/carregar", () => ({ configuracao: m.cfg }));
vi.mock("@/lib/whatsapp/piloto", () => ({ estadoPiloto: m.piloto }));
vi.mock("@/lib/whatsapp/teste-equipe", () => ({ destinatarioTesteEquipe: m.equipe, testeEquipeAtivo: () => process.env.WHATSAPP_ATENDIMENTO_TESTE_EQUIPE === "true" }));
vi.mock("@/lib/eventos", () => ({ publicar: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  entrevistaRecrutamento: { findUnique: vi.fn(async () => null) }, cliente: { findUnique: vi.fn(async () => null) },
  conversa: { findUnique: m.conversa, findUniqueOrThrow: m.carregar, update: m.update }, mensagem: { findMany: m.mensagens, create: vi.fn() },
} }));
vi.mock("@/lib/bot/entrevistas", () => ({ processarBotEntrevista: vi.fn(), registroSeguroEntrevista: (s: string) => s, contemConviteEntrevista: () => false, comandoReservadoEntrevista: () => false }));
import { receberMensagem } from "@/lib/bot/processar";
import { POST as webhookEvolution } from "@/app/api/whatsapp/evolution/route";
import { POST as webhookCloud } from "@/app/api/whatsapp/webhook/route";

const telefone = "5547999990000";
const trintaPalavras = Array(30).fill("palavra").join(" ");
let conversa: { id: string; telefone: string; estado: string; recusaAutomaticas: boolean; ultimaEntradaEm: Date; sessao: unknown; sessaoInicioEm: Date | null };
const recebida = (wamid = "m1", texto = "Quero cortar") => ({ telefone, texto, wamid });
const retorno = (resposta = trintaPalavras) => ({ resposta, historico: [{ role: "user", content: "pedido" }, { role: "assistant", content: resposta }], passouParaHumano: false, recusado: false, ferramentas: [] });

beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-09T12:00:00Z"));
  for (const flag of ["WHATSAPP_ENVIOS_BLOQUEADOS", "WHATSAPP_PILOTO_ENTREVISTAS_HABILITADO", "WHATSAPP_ATENDIMENTO_APOS_PILOTO", "WHATSAPP_ATENDIMENTO_TESTE_EQUIPE", "RECRUTAMENTO_ENTREVISTAS_WHATSAPP_ATIVO"]) vi.stubEnv(flag, "false");
  vi.stubEnv("WHATSAPP_ATENDIMENTO_IA_PAGA", "true");
  conversa = { id: "c1", telefone, estado: "BOT", recusaAutomaticas: false, ultimaEntradaEm: new Date(), sessao: null, sessaoInicioEm: null };
  const vistos = new Set<string>();
  m.entrada.mockImplementation(async (e: { wamid?: string; optOut: boolean }) => {
    if (e.wamid && vistos.has(e.wamid)) return null;
    if (e.wamid) vistos.add(e.wamid);
    conversa.ultimaEntradaEm = new Date();
    if (e.optOut) conversa.recusaAutomaticas = true;
    return { ...conversa };
  });
  m.conversa.mockImplementation(async () => ({ ...conversa }));
  m.carregar.mockImplementation(async () => ({ ...conversa }));
  m.update.mockImplementation(async (q: { data: Partial<typeof conversa> }) => Object.assign(conversa, q.data));
  m.mensagens.mockResolvedValue([{ autor: "CLIENTE", criadoEm: new Date(), texto: "pedido" }]);
  m.cfg.mockResolvedValue({ botAtivo: true, fuso: "America/Sao_Paulo", janelaAgendamentoDias: 30 });
  m.piloto.mockResolvedValue(null); m.equipe.mockResolvedValue(false); m.provedor.mockReturnValue("evolution");
  m.enviar.mockResolvedValue({ ok: true });
  m.modelo.mockResolvedValue(retorno());
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("cadência cancelável do atendimento", () => {
  it("aguarda 22,5 s para 30 palavras e envia sem delay pendente no provedor", async () => {
    const turno = receberMensagem(recebida());
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1); expect(m.enviar).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(22499); expect(m.enviar).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); await turno;
    expect(m.enviar).toHaveBeenCalledExactlyOnceWith("c1", trintaPalavras, "BOT", { digitandoMs: 0, respostaAtendimento: true });
  });

  it("aplica pausa em cada bolha e mantém o simulador imediato", async () => {
    m.modelo.mockResolvedValue(retorno("Olá!\n\nComo posso ajudar?"));
    const turno = receberMensagem(recebida());
    await vi.advanceTimersByTimeAsync(2000); expect(m.enviar).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2249); expect(m.enviar).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); await turno; expect(m.enviar).toHaveBeenCalledTimes(2);
    m.provedor.mockReturnValue("simulador");
    await receberMensagem(recebida("m2"));
    expect(vi.getTimerCount()).toBe(0); expect(m.enviar).toHaveBeenCalledTimes(4);
  });

  it.each(["humano", "recusa", "nova_entrada_no_banco", "bot_desligado", "bloqueio_envios", "ia_desligada", "piloto_ativado", "piloto_sem_cadastro", "teste_equipe_retirado"])("revalida %s depois da pausa", async (caso) => {
    if (caso === "teste_equipe_retirado") { vi.stubEnv("WHATSAPP_ATENDIMENTO_TESTE_EQUIPE", "true"); m.equipe.mockResolvedValue(true); }
    const turno = receberMensagem(recebida()); await vi.advanceTimersByTimeAsync(1000);
    if (caso === "humano") conversa.estado = "HUMANO";
    if (caso === "recusa") conversa.recusaAutomaticas = true;
    if (caso === "nova_entrada_no_banco") conversa.ultimaEntradaEm = new Date();
    if (caso === "bot_desligado") m.cfg.mockResolvedValue({ botAtivo: false });
    if (caso === "bloqueio_envios") vi.stubEnv("WHATSAPP_ENVIOS_BLOQUEADOS", "true");
    if (caso === "ia_desligada") vi.stubEnv("WHATSAPP_ATENDIMENTO_IA_PAGA", "false");
    if (caso.startsWith("piloto_")) vi.stubEnv("WHATSAPP_PILOTO_ENTREVISTAS_HABILITADO", "true");
    if (caso === "piloto_ativado") m.piloto.mockResolvedValue({ ativo: true, telefone, expiraEm: new Date(Date.now() + 60000), enviados: 0, versao: 1 });
    if (caso === "teste_equipe_retirado") m.equipe.mockResolvedValue(false);
    await vi.advanceTimersByTimeAsync(21500); await turno;
    expect(m.enviar).not.toHaveBeenCalled();
  });

  it("nova mensagem cancela a espera imediatamente, sem bolhas antigas nem perda de sessão", async () => {
    m.modelo.mockResolvedValueOnce(retorno("Resposta antiga.\n\nSegunda bolha antiga.")).mockResolvedValueOnce(retorno("Resposta atual."));
    const primeira = receberMensagem(recebida()); await vi.advanceTimersByTimeAsync(1000);
    const segunda = receberMensagem(recebida("m2", "Prefiro amanhã")); await vi.advanceTimersByTimeAsync(0);
    await primeira;
    expect(m.entrada).toHaveBeenCalledTimes(2); expect(m.modelo).toHaveBeenCalledTimes(2);
    expect(m.modelo.mock.calls[1][0].historico).toEqual([{ role: "user", content: "pedido" }]);
    expect(m.enviar).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000); await segunda;
    expect(m.enviar).toHaveBeenCalledExactlyOnceWith("c1", "Resposta atual.", "BOT", { digitandoMs: 0, respostaAtendimento: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("interrompe bolhas restantes se a nova entrada chega depois da primeira", async () => {
    m.modelo.mockResolvedValueOnce(retorno("Primeira.\n\nSegunda antiga.")).mockResolvedValueOnce(retorno("Atual."));
    const primeira = receberMensagem(recebida()); await vi.advanceTimersByTimeAsync(2000);
    expect(m.enviar).toHaveBeenCalledTimes(1);
    const segunda = receberMensagem(recebida("m2")); await vi.advanceTimersByTimeAsync(0); await primeira;
    await vi.advanceTimersByTimeAsync(2000); await segunda;
    expect(m.enviar.mock.calls.map(c => c[1])).toEqual(["Primeira.", "Atual."]);
    expect(m.modelo.mock.calls[1][0].historico).toEqual([{ role: "user", content: "pedido" }, { role: "assistant", content: "Primeira." }]);
  });

  it("PARAR é registrado durante a pausa e só sua confirmação é enviada", async () => {
    const primeira = receberMensagem(recebida()); await vi.advanceTimersByTimeAsync(1000);
    const parar = receberMensagem(recebida("m2", "PARAR")); await vi.advanceTimersByTimeAsync(0);
    await Promise.all([primeira, parar]);
    expect(conversa.recusaAutomaticas).toBe(true); expect(m.modelo).toHaveBeenCalledTimes(1);
    expect(m.enviar).toHaveBeenCalledExactlyOnceWith("c1", expect.stringContaining("Não vou mais mandar"), "BOT", { respostaAtendimento: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("WAMID repetido não cancela a resposta válida nem executa outro turno", async () => {
    const primeira = receberMensagem(recebida()); await vi.advanceTimersByTimeAsync(1000);
    const repetida = receberMensagem(recebida()); await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1); expect(m.modelo).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(21500); await Promise.all([primeira, repetida]);
    expect(m.enviar).toHaveBeenCalledTimes(1); expect(m.modelo).toHaveBeenCalledTimes(1);
  });

  it("registra a nova entrada antes do modelo anterior terminar e preserva FIFO dos turnos", async () => {
    let liberar!: (r: ReturnType<typeof retorno>) => void;
    m.modelo.mockImplementationOnce(() => new Promise(resolve => { liberar = resolve; })).mockResolvedValueOnce(retorno("Atual."));
    const primeira = receberMensagem(recebida()); await vi.advanceTimersByTimeAsync(0);
    const segunda = receberMensagem(recebida("m2", "Novo pedido")); await vi.advanceTimersByTimeAsync(0);
    expect(m.entrada).toHaveBeenCalledTimes(2); expect(m.modelo).toHaveBeenCalledTimes(1);
    const guarda = m.modelo.mock.calls[0][0].podeContinuar as () => Promise<boolean>;
    expect(await guarda()).toBe(false);
    liberar(retorno("Resultado anterior.")); await vi.advanceTimersByTimeAsync(0); await primeira;
    expect(m.modelo).toHaveBeenCalledTimes(2);
    expect(m.modelo.mock.calls[1][0].historico).toEqual([{ role: "user", content: "pedido" }]);
    await vi.advanceTimersByTimeAsync(2000); await segunda;
    expect(m.enviar.mock.calls.map(c => c[1])).toEqual(["Atual."]);
  });

  it("persistir interrupção não reabre HUMANO nem altera a recusa", async () => {
    m.modelo.mockImplementationOnce(async () => {
      conversa.estado = "HUMANO"; conversa.recusaAutomaticas = true;
      return { ...retorno(), interrompido: true };
    });
    await receberMensagem(recebida());
    expect(conversa.estado).toBe("HUMANO"); expect(conversa.recusaAutomaticas).toBe(true);
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: { sessao: [{ role: "user", content: "pedido" }], sessaoInicioEm: expect.any(Date) } }));
    expect(m.enviar).not.toHaveBeenCalled();
  });

  it("falha de entrega não vira fala na sessão nem libera as bolhas seguintes", async () => {
    m.modelo.mockResolvedValue(retorno("Primeira.\n\nSegunda.")); m.enviar.mockResolvedValue({ ok: false });
    const turno = receberMensagem(recebida()); await vi.advanceTimersByTimeAsync(2000); await turno;
    expect(m.enviar).toHaveBeenCalledTimes(1);
    expect(conversa.sessao).toEqual([{ role: "user", content: "pedido" }]);
  });

  it.each(["evolution", "cloud"])("lote %s registra pedido e PARAR sem aguardar a resposta antiga", async (provedor) => {
    const textos = ["Quero cortar", "PARAR"];
    const payload = provedor === "evolution"
      ? { event: "messages.upsert", data: textos.map((texto, i) => ({ key: { id: `m${i}`, remoteJid: `${telefone}@s.whatsapp.net`, fromMe: false }, message: { conversation: texto } })) }
      : { entry: [{ changes: [{ value: { messages: textos.map((texto, i) => ({ id: `m${i}`, from: telefone, type: "text", text: { body: texto } })) } }] }] };
    const body = JSON.stringify(payload);
    vi.stubEnv("WHATSAPP_APP_SECRET", "segredo-ficticio");
    const headers: Record<string, string> = provedor === "evolution" ? { "x-barberos-token": "token-ficticio" } : { "x-hub-signature-256": `sha256=${createHmac("sha256", "segredo-ficticio").update(body).digest("hex")}` };
    const route = provedor === "evolution" ? webhookEvolution : webhookCloud;
    expect((await route(new Request("https://localhost/webhook", { method: "POST", headers, body }))).status).toBe(200);
    expect(m.entrada).not.toHaveBeenCalled();
    const concluir = m.depois.mock.calls[0][0] as () => Promise<void>;
    const lote = concluir(); await vi.advanceTimersByTimeAsync(0); await lote;
    expect(m.entrada.mock.calls.map(c => c[0].texto)).toEqual(textos);
    expect(conversa.recusaAutomaticas).toBe(true);
    expect(m.enviar).toHaveBeenCalledExactlyOnceWith("c1", expect.stringContaining("Não vou mais mandar"), "BOT", { respostaAtendimento: true });
    expect(vi.getTimerCount()).toBe(0);
  });
});
