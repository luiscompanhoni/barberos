import { createECDH, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authPushValido, categoriaPermitida, chavePublicaValida, endpointPushValido, hrefNotificacaoValido, PREFERENCIAS_PADRAO, resultadoErroPush } from "@/lib/notificacoes/regras";
import { exigirOrigemNotificacoes, corpoNotificacoes } from "@/lib/notificacoes/seguranca";
import { zInscricaoPush } from "@/lib/notificacoes/inscricoes";
import { z } from "zod";

afterEach(() => vi.unstubAllEnvs());

describe("destinos Web Push", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc_123:xyz",
    "https://fcm.googleapis.com/wp/abc-123",
    "https://updates.push.services.mozilla.com/wpush/v2/abc_123==",
    "https://web.push.apple.com/abc123_456",
    "https://wns2-ln2p.notify.windows.com/?token=abc%2B123",
  ])("aceita somente formato de provedor conhecido: %s", (url) => expect(endpointPushValido(url)).toBe(true));
  it.each([
    "http://fcm.googleapis.com/fcm/send/abc", "https://127.0.0.1/push", "https://169.254.169.254/latest/meta-data",
    "https://localhost/push", "https://fcm.googleapis.com.evil.test/fcm/send/a", "https://evil.test@fcm.googleapis.com/fcm/send/a",
    "https://fcm.googleapis.com:8443/fcm/send/a", "https://fcm.googleapis.com/fcm/send/a#fragmento",
    "https://fcm.googleapis.com/fcm/send/a?redirect=https://evil.test", "https://evil.notify.windows.com.evil.test/?token=a",
    "https://a.b.notify.windows.com/?token=a", "https://web.push.apple.com.evil.test/a", "https://updates.push.services.mozilla.com/redirect/a",
  ])("rejeita endpoint arbitrário ou ambíguo: %s", (url) => expect(endpointPushValido(url)).toBe(false));
  it("valida chaves EC e autenticação pelo formato e comprimento reais", () => {
    const ec = createECDH("prime256v1"); ec.generateKeys();
    expect(chavePublicaValida(ec.getPublicKey().toString("base64url"))).toBe(true);
    expect(chavePublicaValida(Buffer.alloc(65, 4).toString("base64url"))).toBe(false);
    expect(authPushValido(randomBytes(16).toString("base64url"))).toBe(true);
    expect(authPushValido(randomBytes(15).toString("base64url"))).toBe(false);
  });
  it("inscrição não aceita escolher outro destinatário", () => {
    const ec = createECDH("prime256v1"); ec.generateKeys();
    expect(zInscricaoPush.safeParse({ endpoint: "https://fcm.googleapis.com/fcm/send/a", keys: { p256dh: ec.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") }, usuarioId: "outro" }).success).toBe(false);
  });
});

describe("navegação e consentimento", () => {
  it.each(["/c/notificacoes", "/c/agendar?servico=abc", "/notificacoes", "/meu-dia"])("aceita caminho interno %s", (href) => expect(hrefNotificacaoValido(href)).toBe(true));
  it.each(["https://evil.test", "//evil.test", "/\\evil.test", "/c/%2f%2fevil.test", "/api/usuarios", "/c/../../api/secrets"])("bloqueia caminho %s", (href) => expect(hrefNotificacaoValido(href)).toBe(false));
  it("recompra exige consentimento explícito e categoria desconhecida nunca é aceita", () => {
    expect(categoriaPermitida("RECOMPRA", PREFERENCIAS_PADRAO)).toBe(false);
    expect(categoriaPermitida("RECOMPRA", { ...PREFERENCIAS_PADRAO, recompra: true })).toBe(true);
    expect(categoriaPermitida("inventada", PREFERENCIAS_PADRAO)).toBe(false);
  });
  it("exige origem configurada e rejeita origin ausente/cross-site", () => {
    vi.stubEnv("SITE_URL", "https://cliente.exemplo.test"); vi.stubEnv("PAINEL_URL", "https://painel.exemplo.test");
    const req = (origin?: string, site = "same-origin") => new Request("https://painel.exemplo.test/api/notificacoes/inscricoes", { method: "POST", headers: { ...(origin ? { origin } : {}), "sec-fetch-site": site } });
    expect(exigirOrigemNotificacoes(req("https://painel.exemplo.test"))).toBe("https://painel.exemplo.test");
    expect(() => exigirOrigemNotificacoes(req())).toThrow("dentro do aplicativo");
    expect(() => exigirOrigemNotificacoes(req("https://outro.test"))).toThrow();
    expect(() => exigirOrigemNotificacoes(req("https://painel.exemplo.test", "cross-site"))).toThrow();
  });
  it("limita corpo e exige JSON exato para mutações com conteúdo", async () => {
    await expect(corpoNotificacoes(new Request("https://teste.test", { method: "POST", body: "{}", headers: { "content-type": "text/plain" } }), z.object({}))).rejects.toThrow("JSON");
    await expect(corpoNotificacoes(new Request("https://teste.test", { method: "POST", body: " ".repeat(12_001), headers: { "content-type": "application/json" } }), z.object({}))).rejects.toThrow("grandes");
  });
});

describe("resultado do transporte", () => {
  it.each([404, 410])("desativa inscrição removida pelo provedor (%s)", (statusCode) => expect(resultadoErroPush({ statusCode })).toMatchObject({ estado: "FALHOU", desativar: true }));
  it("timeout e falha sem resposta são incertos, sem tentativa automática", () => {
    expect(resultadoErroPush({ code: "ETIMEDOUT" })).toMatchObject({ estado: "INCERTO" });
    expect(resultadoErroPush({ statusCode: 408 })).toMatchObject({ estado: "INCERTO" });
  });
  it("429 usa espera limitada e 403 não entra em loop", () => {
    expect(resultadoErroPush({ statusCode: 429, headers: { "retry-after": "999999" } })).toMatchObject({ estado: "PENDENTE", esperarSegundos: 3600 });
    expect(resultadoErroPush({ statusCode: 403 })).toMatchObject({ estado: "FALHOU", codigo: "HTTP_403" });
  });
});
