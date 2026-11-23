import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { iniciarConviteApp } from "@/lib/whatsapp/convite-app";
import { enviarTexto } from "@/lib/whatsapp/canal";

const m = vi.hoisted(() => ({
  contato: vi.fn(),
  visita: vi.fn(),
  transporte: vi.fn(),
  mensagem: vi.fn(),
  tx: {
    conversa: { updateMany: vi.fn() },
    campanhaEnvio: { update: vi.fn() },
    jornadaConviteApp: { create: vi.fn(), updateMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/agenda/carregar", () => ({ configuracao: async () => ({ botAtivo: true }) }));
vi.mock("@/lib/convites/roleta-leonel", () => ({ reservarRoletaLeonel: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ auditar: vi.fn() }));
vi.mock("@/lib/eventos", () => ({ publicar: vi.fn() }));
vi.mock("node:timers/promises", async original => ({
  ...await original<typeof import("node:timers/promises")>(), setTimeout: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  $transaction: (executar: (tx: typeof m.tx) => unknown) => executar(m.tx),
  conversa: { findUnique: m.contato, findUniqueOrThrow: m.contato, updateMany: vi.fn() },
  cliente: { findUnique: async () => ({ aceitaMensagens: true, excluidoEm: null }) },
  agendamento: { findFirst: m.visita },
  mensagem: { create: m.mensagem },
} }));

beforeEach(() => {
  vi.clearAllMocks();
  for (const [nome, valor] of Object.entries({
    AMBIENTE: "producao",
    SITE_URL: "https://black.example",
    WHATSAPP_PROVIDER: "evolution",
    EVOLUTION_URL: "https://evolution.invalid",
    EVOLUTION_API_KEY: "simulada",
    EVOLUTION_INSTANCIA: "teste",
    WHATSAPP_ENVIOS_BLOQUEADOS: "false",
    WHATSAPP_ATENDIMENTO_TESTE_EQUIPE: "false",
    WHATSAPP_ATENDIMENTO_APOS_PILOTO: "true",
    WHATSAPP_PILOTO_ENTREVISTAS_HABILITADO: "false",
    BARBEROS_QUARENTENA_RESTAURACAO: "false",
  })) vi.stubEnv(nome, valor);
  vi.stubGlobal("fetch", m.transporte);
  const telefone = "5547999990000";
  const contato = {
    id: "conversa", telefone, waId: null, estado: "BOT", recusaAutomaticas: false, ultimaEntradaEm: null,
    cliente: { id: "cliente", nome: "João Teste", telefone, aceitaMensagens: true, excluidoEm: null },
  };
  m.contato.mockResolvedValue({ ...contato, conviteApp: "ABRINDO" })
    .mockResolvedValueOnce({ ...contato, conviteApp: null });
  m.tx.conversa.updateMany.mockResolvedValue({ count: 1 });
  m.tx.$queryRaw.mockResolvedValue([]);
  m.mensagem.mockResolvedValue({ id: "mensagem" });
  m.transporte.mockImplementation(async () => Response.json({ key: { id: "enviado" } }, { status: 201 }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each([[120, "frio", "rotf"], [200, "muitoFrio", "rotm"]] as const)(
  "após %i dias, solicita prévia somente no último balão de %s",
  async (dias, segmento, prefixo) => {
    m.visita.mockResolvedValue({ inicio: new Date(Date.now() - dias * 86_400_000) });
    await expect(iniciarConviteApp("conversa", "gestor", true)).resolves.toEqual({ segmento });
    const baloes = m.transporte.mock.calls.map(([, req]) => JSON.parse(req.body));
    expect(baloes.map(balao => balao.linkPreview)).toEqual([undefined, undefined, true]);
    expect(baloes[2].text).toMatch(new RegExp(`^https://black\\.example/c/r/${prefixo}_[a-f0-9]{32}$`));
  },
);

it("mantém o link direto de cadastro sem a prévia de roleta", async () => {
  m.visita.mockResolvedValue({ inicio: new Date(Date.now() - 10 * 86_400_000) });
  await expect(iniciarConviteApp("conversa", "gestor", true)).resolves.toEqual({ segmento: "quente" });
  const baloes = m.transporte.mock.calls.map(([, req]) => JSON.parse(req.body));
  expect(baloes.map(balao => balao.linkPreview)).toEqual([undefined, undefined, undefined, undefined]);
  expect(baloes[3].text).toMatch(/^https:\/\/black\.example\/c\/entrar\?convite=appq_[a-f0-9]{32}$/);
});

it("preserva a regra de links reconhecidos da Cloud API com prévia de roleta solicitada", async () => {
  vi.stubEnv("WHATSAPP_PROVIDER", "cloud");
  vi.stubEnv("WHATSAPP_TOKEN", "simulado");
  vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "teste");
  m.transporte.mockResolvedValueOnce(Response.json({ messages: [{ id: "cloud" }] }));
  const texto = "https://black.example/c/r/invalido";
  await expect(enviarTexto("5547999990000", texto, 0, "CONVITE_APP", true)).resolves.toEqual({ wamid: "cloud" });
  const [, req] = m.transporte.mock.calls[0];
  expect(JSON.parse(req.body)).toEqual({
    messaging_product: "whatsapp", recipient_type: "individual", to: "5547999990000",
    type: "text", text: { preview_url: false, body: texto },
  });
});
