import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";

// O loop do bot nao precisa de banco: as ferramentas sao injetadas.
vi.mock("@/lib/bot/ferramentas", () => ({ FERRAMENTAS: [], executarFerramenta: vi.fn() }));
const { executarTurno } = await import("@/lib/bot/agente");
const { calendario, contextoDaMensagem } = await import("@/lib/bot/prompt");

type Params = Anthropic.Beta.MessageCreateParamsNonStreaming;
type Bloco = Anthropic.Beta.BetaContentBlock;

function resposta(content: unknown[], stop_reason: string): Anthropic.Beta.BetaMessage {
  return { id: "msg", type: "message", role: "assistant", model: "teste", content: content as Bloco[], stop_reason, stop_sequence: null } as unknown as Anthropic.Beta.BetaMessage;
}

/** Modelo falso que devolve respostas roteirizadas e guarda o que recebeu. */
function modeloRoteirizado(respostas: Anthropic.Beta.BetaMessage[]) {
  const chamadas: Params[] = [];
  return {
    chamadas,
    modelo: {
      criar: async (p: Params) => {
        chamadas.push(structuredClone(p));
        const r = respostas.shift();
        if (!r) throw new Error("sem resposta roteirizada");
        return r;
      },
    },
  };
}

const ctx = { conversaId: "c1", telefone: "5511999990000", nomePerfil: "Ana" };
const base = { sistema: "sistema", contexto: "<contexto>agora</contexto>", ctx, nomeModelo: "claude-opus-5-5" };

describe("executarTurno", () => {
  it("interrompe ferramentas se a equipe assumir enquanto o modelo responde", async () => {
    const { modelo } = modeloRoteirizado([resposta([{ type: "tool_use", id: "t1", name: "agendar", input: {} }], "tool_use")]);
    const podeContinuar = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false);
    const executor = vi.fn();
    const r = await executarTurno({ ...base, historico: [], texto: "Pode marcar", modelo, executor, podeContinuar });
    expect(r.interrompido).toBe(true); expect(r.resposta).toBe(""); expect(executor).not.toHaveBeenCalled();
  });
  it("conclui o aviso do próprio encaminhamento sem voltar a executar ações", async () => {
    let ativo = true;
    const { modelo, chamadas } = modeloRoteirizado([
      resposta([{ type: "tool_use", id: "t1", name: "chamar_atendente", input: {} }], "tool_use"),
    ]);
    const executor = vi.fn(async () => { ativo = false; return { texto: "Encaminhado", passouParaHumano: true }; });
    const r = await executarTurno({ ...base, historico: [], texto: "Quero uma pessoa", modelo, executor, podeContinuar: async () => ativo });
    expect(r.interrompido).not.toBe(true); expect(r.resposta).toBe("Pedi para a equipe continuar por aqui."); expect(executor).toHaveBeenCalledTimes(1);
    expect(chamadas).toHaveLength(1);
  });
  it("encaminha imagem ao modelo existente e bloqueia alteração baseada só em figurinha", async () => {
    const { modelo, chamadas } = modeloRoteirizado([
      resposta([{ type: "tool_use", id: "t1", name: "agendar", input: {} }], "tool_use"),
      resposta([{ type: "text", text: "Confirma por texto o dia e o horário?" }], "end_turn"),
    ]);
    const executor = vi.fn();
    await executarTurno({ ...base, historico: [], texto: "[figurinha]", imagem: { tipo: "image/jpeg", base64: "aW1hZ2Vt" }, somenteConsulta: true, modelo, executor });
    expect(chamadas[0].messages[0].content).toContainEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "aW1hZ2Vt" } });
    expect(executor).not.toHaveBeenCalled();
  });
  it("não executa chamadas posteriores depois de transferir para humano", async () => {
    const { modelo } = modeloRoteirizado([
      resposta([{ type: "tool_use", id: "t1", name: "chamar_atendente", input: {} }, { type: "tool_use", id: "t2", name: "agendar", input: {} }], "tool_use"),
      resposta([{ type: "text", text: "A equipe vai conferir." }], "end_turn"),
    ]);
    const executor = vi.fn().mockResolvedValue({ texto: "Encaminhado", passouParaHumano: true });
    await executarTurno({ ...base, historico: [], texto: "Quero atendente", modelo, executor });
    expect(executor).toHaveBeenCalledTimes(1);
  });
  it("executa ferramentas e devolve o texto final", async () => {
    const { modelo, chamadas } = modeloRoteirizado([
      resposta([
        { type: "text", text: "Vou ver." },
        { type: "tool_use", id: "t1", name: "consultar_horarios", input: { data: "2026-10-01", servico_id: "s1" } },
        { type: "tool_use", id: "t2", name: "listar_servicos", input: {} },
      ], "tool_use"),
      resposta([{ type: "text", text: "Tenho 14h ou 15h com o Joao." }], "end_turn"),
    ]);
    const executor = vi.fn(async (nome: string) => ({ texto: nome === "listar_servicos" ? "[]" : "{\"horarios\":[\"14:00\"]}" }));

    const r = await executarTurno({ ...base, historico: [], texto: "tem horario quinta?", modelo, executor });

    expect(r.resposta).toBe("Tenho 14h ou 15h com o Joao.");
    expect(executor).toHaveBeenCalledTimes(2);
    expect(r.ferramentas).toEqual(["consultar_horarios", "listar_servicos"]);
    // As duas respostas de ferramenta vao juntas numa unica mensagem.
    const seg = chamadas[1].messages;
    const ultima = seg[seg.length - 1];
    expect(ultima.role).toBe("user");
    expect((ultima.content as unknown[]).length).toBe(2);
    // Parametros do modelo atual: effort baixo, fallback e cache.
    expect(chamadas[0].output_config).toEqual({ effort: "low" });
    expect(chamadas[0].fallbacks).toBe("default");
    expect(chamadas[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("historico so cresce: o que ja foi enviado nao muda", async () => {
    const anterior: Anthropic.Beta.BetaMessageParam[] = [
      { role: "user", content: [{ type: "text", text: "oi" }] },
      { role: "assistant", content: [{ type: "thinking", thinking: "", signature: "sig" }, { type: "text", text: "Ola!" }] },
    ];
    const copia = structuredClone(anterior);
    const { modelo, chamadas } = modeloRoteirizado([resposta([{ type: "text", text: "Claro." }], "end_turn")]);
    const r = await executarTurno({ ...base, historico: anterior, texto: "quero cortar", modelo, executor: vi.fn() });

    expect(chamadas[0].messages.slice(0, 2)).toEqual(copia);
    expect(r.historico.slice(0, 2)).toEqual(copia);
    expect(r.historico).toHaveLength(4);
  });

  it("recusa do modelo nao altera o historico", async () => {
    const { modelo } = modeloRoteirizado([resposta([], "refusal")]);
    const r = await executarTurno({ ...base, historico: [], texto: "...", modelo, executor: vi.fn() });
    expect(r.recusado).toBe(true);
    expect(r.historico).toEqual([]);
  });

  it("marca passagem para humano quando a ferramenta pede", async () => {
    const { modelo } = modeloRoteirizado([
      resposta([{ type: "tool_use", id: "t1", name: "chamar_atendente", input: { motivo: "reclamacao" } }], "tool_use"),
      resposta([{ type: "text", text: "Ja chamei alguem da equipe." }], "end_turn"),
    ]);
    const executor = vi.fn(async () => ({ texto: "ok", passouParaHumano: true }));
    const r = await executarTurno({ ...base, historico: [], texto: "quero reclamar", modelo, executor });
    expect(r.passouParaHumano).toBe(true);
  });

  it("modelo antigo nao recebe parametros so da familia atual", async () => {
    const { modelo, chamadas } = modeloRoteirizado([resposta([{ type: "text", text: "oi" }], "end_turn")]);
    await executarTurno({ ...base, nomeModelo: "claude-haiku-4-5", historico: [], texto: "oi", modelo, executor: vi.fn() });
    expect(chamadas[0].output_config).toBeUndefined();
    expect(chamadas[0].fallbacks).toBeUndefined();
  });
});

describe("prompt", () => {
  it("permite consultar um presente a partir de imagem sem autorizar ação", async () => {
    const { modelo } = modeloRoteirizado([
      resposta([{ type: "tool_use", id: "p", name: "meus_presentes", input: {} }], "tool_use"),
      resposta([{ type: "text", text: "Esse prêmio está disponível." }], "end_turn"),
    ]);
    const executor = vi.fn().mockResolvedValue({ texto: "Prêmio confirmado disponível" });
    await executarTurno({ ...base, historico: [], texto: "[imagem recebida]", somenteConsulta: true, modelo, executor });
    expect(executor).toHaveBeenCalledWith("meus_presentes", {}, base.ctx);
  });
  it("calendario marca hoje e amanha com o dia da semana", () => {
    const c = calendario("2026-09-29", 3);
    expect(c).toBe("terça 2026-09-29 (hoje); quarta 2026-09-30 (amanhã); quinta 2026-10-01");
  });
  it("contexto de inicio de sessao traz calendario e cliente", () => {
    const t = contextoDaMensagem({
      agora: Date.parse("2026-09-29T17:40:00Z"), fuso: "America/Sao_Paulo", inicioDeSessao: true,
      janelaDias: 2, cliente: null, nomePerfil: "Ana",
    });
    expect(t).toContain("Agora: 2026-09-29 14:40");
    expect(t).toContain("Calendário:");
    expect(t).toContain("Cliente sem cadastro");
  });
});
