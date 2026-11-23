import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enviarTextoEvolution, indicarDigitacaoEvolution } from "@/lib/whatsapp/evolution";
import { sincronizarDisponibilidadeAtendimento } from "@/lib/whatsapp/disponibilidade-atendimento";

const m = vi.hoisted(() => ({ cfg: vi.fn(), piloto: vi.fn(), transporte: vi.fn() }));
vi.mock("@/lib/agenda/carregar", () => ({ configuracao: m.cfg }));
vi.mock("@/lib/whatsapp/canal", () => ({ provedorWhatsApp: () => process.env.WHATSAPP_PROVIDER }));
vi.mock("@/lib/whatsapp/piloto", () => ({ estadoPiloto: m.piloto }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("EVOLUTION_URL", "https://evolution.invalid");
  vi.stubEnv("EVOLUTION_API_KEY", "simulada");
  vi.stubEnv("EVOLUTION_INSTANCIA", "teste");
  vi.stubEnv("WHATSAPP_PROVIDER", "evolution");
  vi.stubEnv("WHATSAPP_ATENDIMENTO_TESTE_EQUIPE", "false");
  vi.stubEnv("WHATSAPP_ENVIOS_BLOQUEADOS", "false");
  vi.stubEnv("WHATSAPP_ATENDIMENTO_IA_PAGA", "true");
  vi.stubEnv("ANTHROPIC_API_KEY", "simulada");
  vi.stubEnv("WHATSAPP_PILOTO_ENTREVISTAS_HABILITADO", "false");
  vi.stubGlobal("fetch", m.transporte);
  m.transporte.mockResolvedValue(new Response(JSON.stringify({}), { status: 201 }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("solicita prévia no texto da roleta sem perder o atraso nem o identificador da mensagem", async () => {
  const texto = "https://black.example/c/r/rotf_chave";
  m.transporte.mockResolvedValueOnce(new Response(JSON.stringify({ key: { id: "enviado" } }), { status: 201 }));
  await expect(enviarTextoEvolution("5547999990000@s.whatsapp.net", texto, 1200, true)).resolves.toEqual({ wamid: "enviado" });
  const [url, req] = m.transporte.mock.calls[0];
  expect(url).toBe("https://evolution.invalid/message/sendText/teste");
  expect(JSON.parse(req.body)).toEqual({ number: "5547999990000", text: texto, delay: 1200, linkPreview: true });
});

it("mantém o texto comum sem o campo de prévia", async () => {
  await enviarTextoEvolution("5547999990000", "https://black.example");
  const [, req] = m.transporte.mock.calls[0];
  expect(JSON.parse(req.body)).toEqual({ number: "5547999990000", text: "https://black.example" });
});

it("indica digitação no chat sem mandar mensagem nem agendar uma entrega", async () => {
  const controle = new AbortController();
  await indicarDigitacaoEvolution("5547999990000@s.whatsapp.net", 22500, controle.signal);
  const [url, req] = m.transporte.mock.calls[0];
  expect(url).toBe("https://evolution.invalid/chat/sendPresence/teste");
  expect(JSON.parse(req.body)).toEqual({ number: "5547999990000", delay: 22500, presence: "composing" });
  controle.abort();
  expect(req.signal.aborted).toBe(true);
});

it("publica disponibilidade geral quando pode atender e sinaliza a saída ao desligar", async () => {
  m.cfg.mockResolvedValueOnce({ botAtivo: true }).mockResolvedValueOnce({ botAtivo: false });
  m.transporte.mockImplementation(async () => new Response("{}", { status: 201 }));
  await sincronizarDisponibilidadeAtendimento();
  await sincronizarDisponibilidadeAtendimento();
  const chamadas = m.transporte.mock.calls.map(([url, req]) => [url, JSON.parse(req.body)]);
  expect(chamadas).toEqual([
    ["https://evolution.invalid/instance/setPresence/teste", { presence: "available" }],
    ["https://evolution.invalid/instance/setPresence/teste", { presence: "unavailable" }],
  ]);
});

it("mantém a presença da conta sem alteração no piloto, no bloqueio ou no simulador", async () => {
  m.cfg.mockResolvedValue({ botAtivo: true });
  vi.stubEnv("WHATSAPP_ATENDIMENTO_TESTE_EQUIPE", "true");
  await sincronizarDisponibilidadeAtendimento();
  vi.stubEnv("WHATSAPP_ATENDIMENTO_TESTE_EQUIPE", "false");
  vi.stubEnv("WHATSAPP_ENVIOS_BLOQUEADOS", "true");
  await sincronizarDisponibilidadeAtendimento();
  vi.stubEnv("WHATSAPP_ENVIOS_BLOQUEADOS", "false");
  vi.stubEnv("WHATSAPP_PROVIDER", "simulador");
  await sincronizarDisponibilidadeAtendimento();
  expect(m.transporte).not.toHaveBeenCalled();
});
