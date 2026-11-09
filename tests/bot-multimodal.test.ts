import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { lerMensagens, lerMensagensEvolution } from "@/lib/whatsapp/webhook";
import { baixarMidia, lerLimitado, urlMidiaMeta } from "@/lib/whatsapp/midia-baixar";
import { historicoSemImagens, prepararMidia } from "@/lib/bot/multimodal";

afterEach(() => vi.unstubAllEnvs());
const arquivo = { provedor: "evolution" as const, tipo: "audio" as const, id: "m1" };

describe("mídia recebida", () => {
  it("extrai ID oficial e legenda sem confiar na URL de download", () => {
    const [m] = lerMensagens({ entry: [{ changes: [{ value: { messages: [{ id: "m1", from: "5547999990000", type: "image", image: { id: "imagem1", caption: "Este erro", mime_type: "image/jpeg", url: "http://localhost/segredo" } }] } }] }] });
    expect(m.texto).toBe("Este erro");
    expect(m.midia).toEqual({ provedor: "cloud", id: "imagem1", tipo: "imagem", mime: "image/jpeg" });
  });
  it("lê áudio encapsulado e figurinha, sem ingerir URL/base64 do webhook", () => {
    const lista = lerMensagensEvolution({ event: "MESSAGES_UPSERT", data: [
      { key: { id: "a1", remoteJid: "5547999990000@s.whatsapp.net" }, message: { ephemeralMessage: { message: { audioMessage: { mimetype: "audio/ogg", seconds: 12, fileLength: "512", url: "http://errado" } } } } },
      { key: { id: "s1", remoteJid: "5547999990000@s.whatsapp.net" }, message: { stickerMessage: { mimetype: "image/webp" } } },
      { key: { id: "own", remoteJid: "5547999990000@s.whatsapp.net", fromMe: true }, message: { audioMessage: {} } },
    ] });
    expect(lista).toHaveLength(2);
    expect(lista[0].midia).toMatchObject({ id: "a1", tipo: "audio", tamanho: 512, segundos: 12 });
    expect(lista[1].midia?.tipo).toBe("figurinha");
    expect(JSON.stringify(lista)).not.toContain("http://errado");
  });
  it("limita bytes mesmo sem cabeçalho e bloqueia origem arbitrária", async () => {
    await expect(lerLimitado(new Response("12345"), 4)).rejects.toThrow();
    expect(urlMidiaMeta("https://lookaside.fbsbx.com/whatsapp_business/attachments").hostname).toBe("lookaside.fbsbx.com");
    for (const url of ["http://lookaside.fbsbx.com/a", "https://evil.test/a", "https://fbcdn.net.evil.test/a", "https://127.0.0.1/a", "https://evil@lookaside.fbsbx.com/a"]) expect(() => urlMidiaMeta(url)).toThrow();
  });
  it("recusa arquivos grandes/longos antes de baixar e não aceita redirects", async () => {
    const requisitar = vi.fn();
    await expect(baixarMidia({ ...arquivo, tamanho: 9_000_000 }, "55", requisitar)).rejects.toThrow();
    await expect(baixarMidia({ ...arquivo, segundos: 121 }, "55", requisitar)).rejects.toThrow();
    expect(requisitar).not.toHaveBeenCalled();
    vi.stubEnv("EVOLUTION_URL", "http://evolution:8080"); vi.stubEnv("EVOLUTION_API_KEY", "teste");
    requisitar.mockResolvedValue(new Response(JSON.stringify({ base64: "YXVkaW8=" })));
    expect((await baixarMidia(arquivo, "5547999990000", requisitar)).toString()).toBe("audio");
    expect(requisitar).toHaveBeenCalledWith(expect.stringContaining("getBase64FromMediaMessage"), expect.objectContaining({ redirect: "error" }));
  });
});

describe("interpretação", () => {
  it("não baixa nem transcreve se a chave estiver desligada", async () => {
    vi.stubEnv("WHATSAPP_MIDIA_ATIVA", "false");
    const baixar = vi.fn();
    await expect(prepararMidia(arquivo, "55", { baixar })).rejects.toThrow();
    expect(baixar).not.toHaveBeenCalled();
  });
  it("converte WebP de figurinha em JPEG válido sem persistir base64 no histórico", async () => {
    vi.stubEnv("WHATSAPP_MIDIA_ATIVA", "true");
    const dados = await sharp({ create: { width: 64, height: 64, channels: 4, background: "#ff000080" } }).webp().toBuffer();
    const r = await prepararMidia({ ...arquivo, tipo: "figurinha" }, "55", { baixar: vi.fn().mockResolvedValue(dados) });
    expect((await sharp(Buffer.from(r.imagem!.base64, "base64")).metadata()).format).toBe("jpeg");
    const h = [{ content: [{ type: "image", source: { data: r.imagem!.base64 } }, { type: "text", text: "Oi" }] }];
    expect(JSON.stringify(historicoSemImagens(h))).not.toContain(r.imagem!.base64);
    expect(h[0].content[0].type).toBe("image"); // não modifica o turno em memória
  });
  it("recusa transcrição insegura em vez de inventar conteúdo", async () => {
    vi.stubEnv("WHATSAPP_MIDIA_ATIVA", "true");
    vi.stubEnv("BOT_TRANSCRICAO_URL", "http://127.0.0.1:8091/transcrever");
    vi.stubEnv("BOT_TRANSCRICAO_TOKEN", "token-local-de-teste-12345678");
    const baixar = vi.fn().mockResolvedValue(Buffer.from("audio"));
    await expect(prepararMidia(arquivo, "55", { baixar, requisitar: vi.fn().mockResolvedValue(new Response(JSON.stringify({ texto: "sexta às seis", confiavel: false, segundos: 5 }))) })).rejects.toThrow();
    const r = await prepararMidia(arquivo, "55", { baixar, requisitar: vi.fn().mockResolvedValue(new Response(JSON.stringify({ texto: "Quero corte", confiavel: true, segundos: 5 }))) });
    expect(r.texto).toContain("Quero corte");
    expect(r.imagem).toBeUndefined();
  });
});
