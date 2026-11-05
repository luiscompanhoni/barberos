import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  piloto: vi.fn(), recentes: vi.fn(), usuario: vi.fn(), criar: vi.fn(),
  evolution: vi.fn(), fetch: vi.fn(), atualizar: vi.fn(), invalidar: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  pilotoEntrevistaWhatsApp: { findUnique: m.piloto },
  codigoLogin: { findMany: m.recentes, create: m.criar },
  usuario: { findUnique: m.usuario },
  $transaction: (fn: (tx: unknown) => unknown) => fn({
    $executeRaw: vi.fn(), pilotoEntrevistaWhatsApp: { findUnique: m.piloto, update: m.atualizar },
    codigoLogin: { findMany: m.recentes, create: m.criar, updateMany: m.invalidar }, usuario: { findUnique: m.usuario },
  }),
} }));
vi.mock("@/lib/auditoria", () => ({ auditar: vi.fn() }));
vi.mock("@/lib/whatsapp/evolution", () => ({ enviarTextoEvolution: m.evolution }));
import { enviarCodigoAcesso, enviarTemplate, enviarTexto } from "@/lib/whatsapp/canal";
import { solicitarCodigo } from "@/lib/auth/otp";

const telefone = "5547999990000";
const encerrado = { ativo: false, telefone, expiraEm: new Date(0), enviados: 40, versao: 3 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("AMBIENTE", "producao");
  vi.stubEnv("WHATSAPP_PILOTO_ENTREVISTAS_HABILITADO", "true");
  vi.stubEnv("WHATSAPP_PROVIDER", "evolution"); vi.stubEnv("OTP_PROVIDER", "whatsapp");
  vi.stubEnv("SESSION_SECRET", "fixture-local-sem-credencial");
  m.piloto.mockResolvedValue(encerrado); m.recentes.mockResolvedValue([]);
  m.usuario.mockResolvedValue({ ativo: true }); m.criar.mockResolvedValue({ id: "fixture" });
  m.evolution.mockResolvedValue({ wamid: "fixture" });
  m.fetch.mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: "fixture" }] }) });
  vi.stubGlobal("fetch", m.fetch);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("autenticação solicitada durante a restrição de entrevistas", () => {
  it("entrega somente código solicitado com piloto encerrado, sem reabri-lo", async () => {
    expect(await solicitarCodigo(telefone, "cliente")).toBeNull();
    expect(m.criar).toHaveBeenCalledTimes(1);
    expect(m.criar.mock.calls[0][0].data.codigoHash).toMatch(/^[a-f0-9]{64}$/);
    expect(m.evolution).toHaveBeenCalledWith(telefone, expect.stringMatching(/^Seu código de acesso é \*\d{6}\*\./), 0);
    expect(m.atualizar).not.toHaveBeenCalled(); expect(m.fetch).not.toHaveBeenCalled();
    expect(m.invalidar).toHaveBeenCalledWith({ where: { telefone, usadoEm: null }, data: { usadoEm: expect.any(Date) } });
  });
  it.each([null, { ...encerrado, telefone: null }, { ...encerrado, telefone: "5547999990001" }, { ...encerrado, ativo: true }])("login independe do cadastro ou estado do piloto %#", async (piloto) => {
    m.piloto.mockResolvedValue(piloto);
    await solicitarCodigo(telefone, "cliente");
    expect(m.criar).toHaveBeenCalledTimes(1); expect(m.evolution).toHaveBeenCalledTimes(1);
    expect(m.piloto).not.toHaveBeenCalled(); expect(m.atualizar).not.toHaveBeenCalled();
  });
  it.each(["promoção", "12345", "1234567", "123456\nOferta"])("não aceita conteúdo livre no canal de autenticação: %s", async (codigo) => {
    await expect(enviarCodigoAcesso(telefone, codigo)).rejects.toThrow("inválido");
    expect(m.evolution).not.toHaveBeenCalled(); expect(m.fetch).not.toHaveBeenCalled();
  });
  it.each([telefone + "@g.us", telefone + "@lid", "abc" + telefone])("não autentica destinos ambíguos %s", async (destino) => {
    await expect(enviarCodigoAcesso(destino, "123456")).rejects.toThrow("inválido");
    expect(m.evolution).not.toHaveBeenCalled();
  });
  it("preserva bloqueio de texto, origem inventada e template comum", async () => {
    await expect(enviarTexto(telefone, "oferta")).rejects.toMatchObject({ status: 403 });
    await expect(enviarTexto(telefone, "oferta", 0, "AUTENTICACAO")).rejects.toMatchObject({ status: 403 });
    await expect(enviarTemplate(telefone, { nome: "oferta", parametros: [], botaoCodigo: "123456" })).rejects.toMatchObject({ status: 403 });
    expect(m.evolution).not.toHaveBeenCalled(); expect(m.fetch).not.toHaveBeenCalled();
  });
  it("mantém intervalo de um minuto sem gerar ou enviar outro código", async () => {
    m.recentes.mockResolvedValue([{ criadoEm: new Date() }]);
    await expect(solicitarCodigo(telefone, "cliente")).rejects.toMatchObject({ status: 429 });
    expect(m.criar).not.toHaveBeenCalled(); expect(m.evolution).not.toHaveBeenCalled();
  });
  it("mantém limite de cinco códigos por hora", async () => {
    m.recentes.mockResolvedValue(Array.from({ length: 5 }, () => ({ criadoEm: new Date(Date.now() - 120_000) })));
    await expect(solicitarCodigo(telefone, "cliente")).rejects.toMatchObject({ status: 429 });
    expect(m.criar).not.toHaveBeenCalled(); expect(m.evolution).not.toHaveBeenCalled();
  });
  it("não envia para usuário inativo ou equipe não cadastrada", async () => {
    m.usuario.mockResolvedValueOnce({ ativo: false }).mockResolvedValueOnce(null);
    await solicitarCodigo(telefone, "cliente"); await solicitarCodigo(telefone, "equipe");
    expect(m.criar).not.toHaveBeenCalled(); expect(m.evolution).not.toHaveBeenCalled();
  });
  it("permite primeiro acesso de cliente ainda não cadastrado", async () => {
    m.usuario.mockResolvedValue(null);
    expect(await solicitarCodigo(telefone, "cliente")).toBeNull();
    expect(m.criar).toHaveBeenCalledTimes(1); expect(m.evolution).toHaveBeenCalledTimes(1);
  });
  it("na Cloud usa exclusivamente o template de autenticação configurado", async () => {
    vi.stubEnv("WHATSAPP_PROVIDER", "cloud"); vi.stubEnv("WHATSAPP_TOKEN", "fixture");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "fixture"); vi.stubEnv("WHATSAPP_TEMPLATE_CODIGO", "codigo_acesso");
    await enviarCodigoAcesso(telefone, "123456");
    const body = JSON.parse(m.fetch.mock.calls[0][1].body);
    expect(body).toMatchObject({ to: telefone, type: "template", template: { name: "codigo_acesso" } });
    expect(body.template.components[0].parameters).toEqual([{ type: "text", text: "123456" }]);
    expect(m.evolution).not.toHaveBeenCalled();
  });
  it("sem modo piloto preserva login de qualquer número elegível", async () => {
    vi.stubEnv("WHATSAPP_PILOTO_ENTREVISTAS_HABILITADO", "false");
    await solicitarCodigo("5547999990001", "cliente");
    expect(m.piloto).not.toHaveBeenCalled(); expect(m.evolution).toHaveBeenCalledTimes(1);
  });
  it("homologação nunca chama transporte real", async () => {
    vi.stubEnv("AMBIENTE", "homologacao");
    await enviarCodigoAcesso(telefone, "123456");
    expect(m.evolution).not.toHaveBeenCalled(); expect(m.fetch).not.toHaveBeenCalled();
  });
});
