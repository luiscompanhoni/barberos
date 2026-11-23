import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/instagram/webhook/route";

const mocks = vi.hoisted(() => ({ registrar: vi.fn(), depois: vi.fn(), processar: vi.fn(), encaminhar: vi.fn(), concluir: vi.fn() }));
vi.mock("next/server", async importOriginal => ({ ...(await importOriginal<typeof import("next/server")>()), after: mocks.depois }));
vi.mock("@/lib/instagram/persistencia", () => ({ registrarEntradaInstagram: mocks.registrar, encaminharEntradaInstagram: mocks.encaminhar, concluirEntradaInstagram: mocks.concluir }));
vi.mock("@/lib/instagram/processar", () => ({ processarEntradaInstagram: mocks.processar }));

const url = "https://painel.exemplo.test/api/instagram/webhook";
const segredo = "app-secret-ficticio";
const perfil = "17841400000001";
const pagina = "887766";

function mensagemAssinada({ objeto = "instagram", conta = perfil, destinatario = perfil, eco = false } = {}) {
  const timestamp = Date.now();
  const entrada = { sender: { id: "1234" }, recipient: { id: destinatario }, timestamp, message: { mid: "m:1", text: "Olá", is_echo: eco } };
  const corpo = `\n ${JSON.stringify({ object: objeto, entry: [{ id: conta, time: timestamp, messaging: [entrada] }] })}\n`;
  const assinatura = `sha256=${createHmac("sha256", segredo).update(corpo).digest("hex")}`;
  return { corpo, assinatura };
}

function requisicao(corpo: string, assinatura: string) {
  return new Request(url, { method: "POST", body: corpo, headers: { "x-hub-signature-256": assinatura } });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("INSTAGRAM_PROVEDOR", "facebook_login");
  vi.stubEnv("INSTAGRAM_PAGE_ID", pagina);
  vi.stubEnv("INSTAGRAM_APP_SECRET", segredo);
  vi.stubEnv("INSTAGRAM_PROFESSIONAL_ACCOUNT_ID", perfil);
  vi.stubEnv("INSTAGRAM_WEBHOOK_VERIFY_TOKEN", "verificacao-ficticia");
  mocks.processar.mockResolvedValue(undefined);
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

  it.each([
    { objeto: "page" },
    { conta: pagina },
    { destinatario: pagina },
    { eco: true },
  ])("aceita e ignora a notificação %# sem gravar nem agendar turno", async opcoes => {
    const { corpo, assinatura } = mensagemAssinada(opcoes);
    expect((await POST(requisicao(corpo, assinatura))).status).toBe(200);
    expect(mocks.registrar).not.toHaveBeenCalled();
    expect(mocks.depois).not.toHaveBeenCalled();
  });

  it("agenda um único turno quando a persistência detecta a repetição do MID", async () => {
    const { corpo, assinatura } = mensagemAssinada();
    const registrada = { conversaId: "c-teste", mid: "m:1", timestamp: Date.now(), texto: "Olá" };
    mocks.registrar.mockResolvedValueOnce(registrada).mockResolvedValueOnce(null);
    expect((await POST(requisicao(corpo, assinatura))).status).toBe(200);
    expect((await POST(requisicao(corpo, assinatura))).status).toBe(200);
    expect(mocks.registrar).toHaveBeenCalledTimes(2);
    expect(mocks.registrar).toHaveBeenCalledWith({ igsid: "1234", mid: "m:1", timestamp: expect.any(Number), texto: "Olá" });
    expect(mocks.depois).toHaveBeenCalledOnce();
    await mocks.depois.mock.calls[0][0]();
    expect(mocks.processar).toHaveBeenCalledExactlyOnceWith(registrada);
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
    expect(mocks.concluir).not.toHaveBeenCalled();
    await mocks.depois.mock.calls[0][0]();
    expect(mocks.processar).toHaveBeenCalledExactlyOnceWith(registrada);
    expect(mocks.concluir).toHaveBeenCalledExactlyOnceWith(registrada);
  });

  it("mantém a entrada pendente quando o processamento e o encaminhamento falham", async () => {
    const { corpo, assinatura } = mensagemAssinada();
    const registrada = { conversaId: "c-teste", mid: "m:1", timestamp: Date.now(), texto: "Olá" };
    mocks.registrar.mockResolvedValueOnce(registrada);
    mocks.processar.mockRejectedValueOnce(new Error("Falha no turno"));
    mocks.encaminhar.mockRejectedValueOnce(new Error("Falha no banco"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await POST(requisicao(corpo, assinatura))).status).toBe(200);
      await mocks.depois.mock.calls[0][0]();
      expect(mocks.encaminhar).toHaveBeenCalledOnce();
      expect(mocks.concluir).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });
});
