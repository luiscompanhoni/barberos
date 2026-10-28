import { createECDH, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ enviar: vi.fn() }));
vi.mock("web-push", () => ({ default: { sendNotification: mock.enviar } }));
import { configuracaoPush, configuracaoPushPublica } from "@/lib/notificacoes/configuracao";
import { enviarPush } from "@/lib/notificacoes/provedor";
import { hashPush } from "@/lib/notificacoes/regras";

const ec = createECDH("prime256v1"); ec.generateKeys();
const publica = ec.getPublicKey().toString("base64url");
const privada = ec.getPrivateKey().toString("base64url");
const destino = { endpoint: "https://fcm.googleapis.com/fcm/send/teste", p256dh: publica, auth: randomBytes(16).toString("base64url"), vapidHash: hashPush(publica) };
const aviso = { id: "aviso-sem-dados", href: "/notificacoes", expiraEm: new Date(Date.now() + 60_000) };
beforeEach(() => { mock.enviar.mockReset(); vi.stubEnv("VAPID_PUBLIC_KEY", publica); vi.stubEnv("VAPID_PRIVATE_KEY", privada); vi.stubEnv("VAPID_SUBJECT", "mailto:suporte@example.test"); vi.stubEnv("AMBIENTE", "teste"); vi.stubEnv("PUSH_PROVIDER", "webpush"); });
afterEach(() => vi.unstubAllEnvs());

describe("provedor seguro", () => {
  it("homologação sempre simula, mesmo com VAPID e pedido explícito contrário", async () => {
    vi.stubEnv("AMBIENTE", "homologacao");
    expect(configuracaoPush().modo).toBe("simulado");
    expect(await enviarPush(destino, aviso, { simular: false })).toMatchObject({ estado: "SIMULADO" });
    expect(mock.enviar).not.toHaveBeenCalled();
  });
  it("padrão desativado e chave ausente nunca enviam", async () => {
    vi.stubEnv("PUSH_PROVIDER", "");
    expect(configuracaoPushPublica()).toMatchObject({ modo: "desativado", disponivel: false, chavePublica: null });
    expect(await enviarPush(destino, aviso)).toMatchObject({ codigo: "PROVEDOR_DESATIVADO" });
    vi.stubEnv("PUSH_PROVIDER", "webpush"); vi.stubEnv("VAPID_PRIVATE_KEY", "");
    expect(configuracaoPushPublica().disponivel).toBe(false);
    await enviarPush(destino, aviso);
    expect(mock.enviar).not.toHaveBeenCalled();
  });
  it("par de chaves incompatível é indisponível e DTO não revela chave privada", () => {
    vi.stubEnv("VAPID_PRIVATE_KEY", randomBytes(32).toString("base64url"));
    expect(configuracaoPushPublica().disponivel).toBe(false);
    expect(JSON.stringify(configuracaoPushPublica())).not.toContain(privada);
    expect(Object.keys(configuracaoPushPublica())).not.toContain("chavePrivada");
  });
  it("payload contém apenas identificador e navegação interna", async () => {
    mock.enviar.mockResolvedValue({ statusCode: 201 });
    expect(await enviarPush(destino, aviso)).toMatchObject({ estado: "ENVIADO" });
    const [inscricao, payload, opcoes] = mock.enviar.mock.calls[0];
    expect(inscricao.endpoint).toBe(destino.endpoint);
    expect(JSON.parse(payload)).toEqual({ id: aviso.id, href: aviso.href });
    expect(opcoes.timeout).toBe(8000); expect(opcoes.TTL).toBeLessThanOrEqual(60);
  });
  it("erro de transporte não vaza endpoint nem gera novo envio", async () => {
    mock.enviar.mockRejectedValue({ code: "ETIMEDOUT", message: destino.endpoint });
    const r = await enviarPush(destino, aviso);
    expect(r).toEqual({ estado: "INCERTO", codigo: "ENVIO_INDETERMINADO" });
    expect(mock.enviar).toHaveBeenCalledTimes(1);
  });
  it("inscrição de outro servidor é rejeitada antes da chamada externa", async () => {
    expect(await enviarPush({ ...destino, endpoint: "https://127.0.0.1/secret" }, aviso)).toMatchObject({ estado: "FALHOU", codigo: "INSCRICAO_INVALIDA" });
    expect(mock.enviar).not.toHaveBeenCalled();
  });
});
