import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ jwt: vi.fn() }));
vi.mock("jose", () => ({ createRemoteJWKSet: vi.fn(() => "jwks"), jwtVerify: m.jwt }));
import { configuracaoSocial, urlAutorizacao, verificarIdentidadeSocial } from "@/lib/auth/social-provedores";

beforeEach(() => {
  vi.stubEnv("SITE_URL", "https://cliente.example.test");
  for (const p of ["GOOGLE", "FACEBOOK", "APPLE"]) {
    vi.stubEnv(`AUTH_${p}_CLIENT_ID`, `${p.toLowerCase()}-client`); vi.stubEnv(`AUTH_${p}_CLIENT_SECRET`, "server-only-test");
  }
  vi.stubEnv("AUTH_FACEBOOK_API_VERSION", "v99.0");
  m.jwt.mockReset(); vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("provedores de login social", () => {
  it("só disponibiliza com credenciais, e Apple exige HTTPS", () => {
    vi.stubEnv("AUTH_GOOGLE_CLIENT_SECRET", ""); expect(configuracaoSocial("google")).toBeNull();
    vi.stubEnv("SITE_URL", "http://localhost:3000"); expect(configuracaoSocial("apple")).toBeNull();
    expect(configuracaoSocial("facebook")).not.toBeNull();
    vi.stubEnv("AUTH_FACEBOOK_API_VERSION", "https://malicioso.test"); expect(configuracaoSocial("facebook")).toBeNull();
  });
  it("fixa callback, state, nonce e PKCE, sem expor secret na autorização", () => {
    const u = new URL(urlAutorizacao("google", "state", "nonce", "challenge"));
    expect(u.origin).toBe("https://accounts.google.com");
    expect(u.searchParams.get("redirect_uri")).toBe("https://cliente.example.test/api/auth/social/google/retorno");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("code_challenge")).toBe("challenge");
    expect(u.searchParams.get("nonce")).toBe("nonce"); expect(u.searchParams.get("state")).toBe("state");
    expect(u.toString()).not.toContain("server-only-test");
    expect(new URL(urlAutorizacao("apple", "s", "n", "")).searchParams.get("response_mode")).toBe("form_post");
  });
  it("verifica JWT assinado, audiência, emissor, validade e nonce", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ id_token: "signed-token" }));
    m.jwt.mockResolvedValue({ payload: { sub: "provider-person", nonce: "nonce", email: "a@example.test", email_verified: true } });
    expect(await verificarIdentidadeSocial("google", "code", "nonce", "verifier")).toMatchObject({ subject: "provider-person", email: "a@example.test" });
    expect(m.jwt).toHaveBeenCalledWith("signed-token", "jwks", expect.objectContaining({ audience: "google-client", algorithms: ["RS256"], requiredClaims: ["exp", "iat", "sub", "nonce"] }));
    const init = vi.mocked(fetch).mock.calls[0][1];
    expect((init?.body as URLSearchParams).get("code_verifier")).toBe("verifier");
    expect(init?.redirect).toBe("error");
  });
  it("recusa nonce divergente ou validação criptográfica falha", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ id_token: "token" }));
    m.jwt.mockResolvedValue({ payload: { sub: "person", nonce: "outro" } });
    await expect(verificarIdentidadeSocial("apple", "code", "nonce", "")).rejects.toThrow("validar");
    m.jwt.mockRejectedValue(new Error("invalid signature"));
    await expect(verificarIdentidadeSocial("google", "code", "nonce", "v")).rejects.toThrow("validar");
  });
  it("não usa e-mail não verificado do Google", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ id_token: "token" }));
    m.jwt.mockResolvedValue({ payload: { sub: "person", nonce: "nonce", email: "someone@example.test", email_verified: false } });
    expect((await verificarIdentidadeSocial("google", "code", "nonce", "v")).email).toBeUndefined();
  });
  it("recusa token Facebook emitido para outra aplicação", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ access_token: "fb-token" }))
      .mockResolvedValueOnce(Response.json({ data: { is_valid: true, app_id: "other-app", user_id: "u1", expires_at: Date.now() / 1000 + 3600 } }));
    await expect(verificarIdentidadeSocial("facebook", "code", "n", "v")).rejects.toThrow("validar");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("Facebook exige sujeito coerente e envia prova do secret para /me", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ access_token: "fb-token" }))
      .mockResolvedValueOnce(Response.json({ data: { is_valid: true, app_id: "facebook-client", user_id: "u1", expires_at: Date.now() / 1000 + 3600 } }))
      .mockResolvedValueOnce(Response.json({ id: "u1", name: "Pessoa" }));
    expect(await verificarIdentidadeSocial("facebook", "code", "n", "v")).toMatchObject({ subject: "u1", provedor: "facebook" });
    expect(String(vi.mocked(fetch).mock.calls[2][0])).toContain("appsecret_proof=");
    expect(vi.mocked(fetch).mock.calls[2][1]?.headers).toEqual({ Authorization: "Bearer fb-token" });
  });
});
