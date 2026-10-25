import { describe, expect, it, afterEach } from "vitest";
import { mkdtemp, readdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assinaturaValida, faixa, validarCortes, zClipe } from "@/lib/estudio/regras";
import { apagar, caminho, receber } from "@/lib/estudio/arquivos";
const pastas: string[] = [];
afterEach(async () => { for (const p of pastas.splice(0)) await rm(p, { recursive: true, force: true }); delete process.env.ESTUDIO_STORAGE_ROOT; });
describe("mídias privadas do Estúdio", () => {
  it("rejeita travessia de diretório", () => { expect(() => caminho("../../.env")).toThrow(); expect(() => caminho("file:///secret")).toThrow(); });
  it.each([["bytes=0-9", { inicio: 0, fim: 9 }], ["bytes=9-", { inicio: 9, fim: 99 }], ["bytes=-10", { inicio: 90, fim: 99 }], ["bytes=90-999", { inicio: 90, fim: 99 }], ["bytes=100-", false], ["bytes=-0", false], ["bytes=3-2", false], ["bytes=0-1,4-5", false], ["bytes=-", false], ["bytes=999999999999999999999-", false]] as const)("faixa %s", (h, r) => expect(faixa(h, 100)).toEqual(r));
  it("confere assinatura e limite do upload mesmo com MIME alegado", () => {
    expect(assinaturaValida(new TextEncoder().encode("<script>alert('x')</script>"), "video/mp4")).toBe(false);
    expect(zClipe.safeParse({ nome: "a", bytes: 101 * 1024 * 1024, mime: "video/mp4", duracao: 10, revisao: 0 }).success).toBe(false);
  });
  it("valida cortes e duração total", () => {
    expect(validarCortes([{ inicio: 3, fim: 2, duracao: 5 }])).toBe(false);
    expect(validarCortes([{ inicio: 0, fim: 6, duracao: 5 }])).toBe(false);
    expect(validarCortes([{ inicio: 0, fim: 121, duracao: 122 }])).toBe(false);
    expect(validarCortes([{ inicio: 2, fim: 8, duracao: 10 }])).toBe(true);
  });
  it("interrompe stream acima do limite e remove o arquivo parcial", async () => {
    const p = await mkdtemp(join(tmpdir(), "black-upload-test-")); pastas.push(p); process.env.ESTUDIO_STORAGE_ROOT = p;
    const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(64)); c.enqueue(new Uint8Array(64)); c.close(); } });
    await expect(receber(new Request("http://localhost", { method: "PUT", body: stream, duplex: "half" } as RequestInit), null, 100, "video/mp4")).rejects.toMatchObject({ status: 413 });
    expect(await readdir(p)).toEqual([]);
  });
  it("persiste bytes exatos e hash de um envio válido; recusa truncado", async () => {
    const p = await mkdtemp(join(tmpdir(), "black-upload-test-")); pastas.push(p); process.env.ESTUDIO_STORAGE_ROOT = p;
    const b = Buffer.alloc(64); b.write("ftyp", 4);
    const r = await receber(new Request("http://localhost", { method: "PUT", body: b }), 64, 100, "video/mp4");
    expect(r.bytes).toBe(64); expect(r.hash).toMatch(/^[0-9a-f]{64}$/); expect(await readFile(caminho(r.chave))).toEqual(b);
    await apagar(r.chave);
    await expect(receber(new Request("http://localhost", { method: "PUT", body: b }), 65, 100, "video/mp4")).rejects.toMatchObject({ status: 400 });
    expect(await readdir(p)).toEqual([]);
  });
});
