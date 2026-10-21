import { describe, expect, it } from "vitest";
import { lerFotoChecklist, MAX_FOTO_BYTES } from "@/lib/checklist/foto-validacao";

describe("Fotos opcionais do checklist", () => {
  it("aceita PNG com assinatura compatível", () => {
    const foto = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
    const r = lerFotoChecklist(`data:image/png;base64,${foto.toString("base64")}`);
    expect(r.dados).toEqual(foto);
    expect(r.tipo).toBe("image/png");
  });
  it("recusa HTML/SVG e conteúdo que finge ser imagem", () => {
    expect(() => lerFotoChecklist("data:image/svg+xml;base64,PHN2Zz4=")).toThrow();
    expect(() => lerFotoChecklist("data:image/png;base64,PGh0bWw+")).toThrow();
  });
  it("limita o tamanho gravado no banco", () => {
    const foto = Buffer.alloc(MAX_FOTO_BYTES + 1, 255);
    expect(() => lerFotoChecklist(`data:image/jpeg;base64,${foto.toString("base64")}`)).toThrow("400 KB");
  });
});
