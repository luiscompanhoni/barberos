import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/cliente-api", () => ({ api: m.api }));

function navegador(opcoes: { permissao?: string; inscrito?: boolean; chaveAntiga?: number[] } = {}) {
  const antiga = { unsubscribe: vi.fn(async () => true), options: { applicationServerKey: Uint8Array.from(opcoes.chaveAntiga ?? [0, 1]).buffer }, toJSON: () => ({ endpoint: "https://push.test/antiga", keys: { auth: "auth", p256dh: "key" } }) };
  const nova = { unsubscribe: vi.fn(async () => true), toJSON: () => ({ endpoint: "https://push.test/nova", keys: { auth: "auth", p256dh: "key" } }) };
  const aviso = { close: vi.fn() };
  const subscribe = vi.fn<(options: { applicationServerKey: Uint8Array; userVisibleOnly: boolean }) => Promise<typeof nova>>().mockResolvedValue(nova);
  const reg = { pushManager: { getSubscription: vi.fn(async () => opcoes.inscrito ? antiga : null), subscribe }, getNotifications: vi.fn(async () => [aviso]) };
  const notification = { requestPermission: vi.fn(async () => opcoes.permissao ?? "granted") };
  const serviceWorker = { register: vi.fn(async () => reg), ready: Promise.resolve(reg), getRegistration: vi.fn(async () => reg) };
  vi.stubGlobal("window", { isSecureContext: true, PushManager: {}, Notification: notification, atob: (v: string) => Buffer.from(v, "base64").toString("binary") });
  vi.stubGlobal("navigator", { serviceWorker }); vi.stubGlobal("Notification", notification);
  return { antiga, nova, reg, aviso, notification, serviceWorker };
}

beforeEach(() => { vi.resetModules(); m.api.mockReset(); m.api.mockResolvedValue({ ok: true }); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("inscrição push depende de gesto e vínculo atual", () => {
  it("importar funções não pede permissão nem cria inscrição", async () => {
    const n = navegador(); await import("@/lib/pwa/push-cliente");
    expect(n.notification.requestPermission).not.toHaveBeenCalled(); expect(n.reg.pushManager.subscribe).not.toHaveBeenCalled();
  });
  it("permissão negada não registra aparelho no servidor", async () => {
    const n = navegador({ permissao: "denied" }); const { ativarPush } = await import("@/lib/pwa/push-cliente");
    await expect(ativarPush("AAE", false)).rejects.toThrow(/bloqueadas/);
    expect(n.reg.pushManager.subscribe).not.toHaveBeenCalled(); expect(m.api).not.toHaveBeenCalled();
  });
  it("troca de conta descarta inscrição velha antes de associar nova", async () => {
    const n = navegador({ inscrito: true }); const { ativarPush } = await import("@/lib/pwa/push-cliente");
    await ativarPush("AAE", false);
    expect(n.antiga.unsubscribe).toHaveBeenCalledOnce(); expect(n.reg.pushManager.subscribe).toHaveBeenCalledOnce();
    expect(m.api).toHaveBeenCalledWith("/api/notificacoes/inscricoes", expect.objectContaining({ body: expect.objectContaining({ endpoint: "https://push.test/nova" }) }));
  });
  it("rotação VAPID recria inscrição mesmo para o mesmo aparelho ativo", async () => {
    const n = navegador({ inscrito: true, chaveAntiga: [9, 9] }); const { ativarPush } = await import("@/lib/pwa/push-cliente");
    await ativarPush("AAE", true);
    expect(n.antiga.unsubscribe).toHaveBeenCalledOnce(); expect(n.reg.pushManager.subscribe).toHaveBeenCalledOnce();
    expect(Array.from(n.reg.pushManager.subscribe.mock.calls[0][0].applicationServerKey)).toEqual([0, 1]);
  });
  it("inscrição ativa com mesma chave é reaproveitada", async () => {
    const n = navegador({ inscrito: true }); const { ativarPush } = await import("@/lib/pwa/push-cliente");
    await ativarPush("AAE", true);
    expect(n.antiga.unsubscribe).not.toHaveBeenCalled(); expect(n.reg.pushManager.subscribe).not.toHaveBeenCalled();
  });
  it("falha no cadastro cancela inscrição recém-criada", async () => {
    const n = navegador(); m.api.mockRejectedValueOnce(new Error("falha de rede")); const { ativarPush } = await import("@/lib/pwa/push-cliente");
    await expect(ativarPush("AAE", false)).rejects.toThrow("falha de rede"); expect(n.nova.unsubscribe).toHaveBeenCalledOnce();
  });
  it("limpeza pós-logout não chama API autenticada e fecha avisos existentes", async () => {
    const n = navegador({ inscrito: true }); const { desativarPushLocal } = await import("@/lib/pwa/push-cliente");
    await desativarPushLocal({ servidor: false });
    expect(m.api).not.toHaveBeenCalled(); expect(n.antiga.unsubscribe).toHaveBeenCalledOnce(); expect(n.aviso.close).toHaveBeenCalledOnce();
  });
  it("desativação pela central limpa inscrição local mesmo com falha de rede", async () => {
    const n = navegador({ inscrito: true }); m.api.mockRejectedValueOnce(new Error("sem conexão")); const { desativarPushLocal } = await import("@/lib/pwa/push-cliente");
    await expect(desativarPushLocal()).rejects.toThrow("sem conexão");
    expect(n.antiga.unsubscribe).toHaveBeenCalledOnce(); expect(n.aviso.close).toHaveBeenCalledOnce();
  });
});
