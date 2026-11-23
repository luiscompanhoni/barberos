import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/instagram/webhook/route";

const mocks = vi.hoisted(() => ({ registrar: vi.fn(), depois: vi.fn(), processar: vi.fn(), encaminhar: vi.fn() }));
vi.mock("next/server", async importOriginal => ({ ...(await importOriginal<typeof import("next/server")>()), after: mocks.depois }));
vi.mock("@/lib/instagram/persistencia", () => ({ registrarEntradaInstagram: mocks.registrar, encaminharEntradaInstagram: mocks.encaminhar }));
vi.mock("@/lib/instagram/processar", () => ({ processarEntradaInstagram: mocks.processar }));

const url = "https://painel.exemplo.test/api/instagram/webhook";
const segredo = "app-secret-ficticio";
const perfil = "17841400000001";

function mensagemAssinada() {
  const entrada = { sender: { id: "1234" }, recipient: { id: perfil }, timestamp: Date.now(), message: { mid: "m:1", text: "Olá" } };
  const corpo = `\n ${JSON.stringify({ object: "instagram", entry: [{ id: perfil, messaging: [entrada] }] })}\n`;
  const assinatura = `sha256=${createHmac("sha256", segredo).update(corpo).digest("hex")}`;
  return { corpo, assinatura };
}

function requisicao(corpo: string, assinatura: string) {
  return new Request(url, { method: "POST", body: corpo, headers: { "x-hub-signature-256": assinatura } });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("INSTAGRAM_APP_SECRET", segredo);
  vi.stubEnv("INSTAGRAM_PROFESSIONAL_ACCOUNT_ID", perfil);
  vi.stubEnv("INSTAGRAM_WEBHOOK_VERIFY_TOKEN", "verificacao-ficticia");
});

afterEach(() => vi.unstubAllEnvs());

describe("rota pública do Instagram", () => {
  it("devolve o desafio como texto e requer o token configurado", async () => {
    const destino = `${url}?hub.mode=subscribe&hub.challenge=123&hub.verify_token=`;
    expect(GET(new Request(`${destino}falso`)).status).toBe(403);
    const resposta = GET(new Request(`${destino}verificacao-ficticia`));
    expect(resposta.status).toBe(200);
    expect(await resposta.text()).toBe("123");
  });

  it("responde 401 antes de gravar quando o corpo original é alterado", async () => {
    const { corpo, assinatura } = mensagemAssinada();
    expect((await POST(requisicao(corpo.trim(), assinatura))).status).toBe(401);
    expect(mocks.registrar).not.toHaveBeenCalled();
    expect(mocks.depois).not.toHaveBeenCalled();
  });

  it("espera a escrita antes do aceite e processa o turno apenas no callback", async () => {
    const { corpo, assinatura } = mensagemAssinada();
    const registrada = { conversaId: "c-teste", mid: "m:1", timestamp: Date.now(), texto: "Olá" };
    let concluir!: (r: typeof registrada) => void;
    mocks.registrar.mockImplementationOnce(() => new Promise(resolve => { concluir = resolve; }));
    let respondeu = false;
    const resposta = POST(requisicao(corpo, assinatura)).then(r => { respondeu = true; return r; });
    await vi.waitFor(() => expect(mocks.registrar).toHaveBeenCalledOnce());
    expect(respondeu).toBe(false);
    concluir(registrada);
    expect((await resposta).status).toBe(200);
    expect(mocks.processar).not.toHaveBeenCalled();
    await mocks.depois.mock.calls[0][0]();
    expect(mocks.processar).toHaveBeenCalledExactlyOnceWith(registrada);
  });
});
