import { describe, expect, it } from "vitest";
import { CONHECIMENTO_BLACK } from "@/lib/agentes/conhecimento-black";
import { readFileSync } from "node:fs";
describe("base aprovada da Black", () => {
  it("mantém origem, escopo e lacunas sem apresentar remuneração como garantia", () => {
    expect(CONHECIMENTO_BLACK.estado).toBe("APROVADO_PELO_USUARIO");
    expect(CONHECIMENTO_BLACK.aprovacao.origem).toContain("Conversa");
    expect(CONHECIMENTO_BLACK.campanha.remuneracao.garantido).toBe(false);
    expect(CONHECIMENTO_BLACK.campanha.remuneracao.usarEmAnuncio).toBe(false);
    expect(CONHECIMENTO_BLACK.aprendizados).toHaveLength(0);
    expect(CONHECIMENTO_BLACK.avaliacao.notasVisiveisAoCandidato).toBe(false);
  });
  it("contexto registra a fonte e modelos privados não são importados pelos componentes", () => {
    expect(readFileSync("src/lib/agentes/contexto.ts", "utf8")).toContain('dados: CONHECIMENTO_BLACK');
    const editor = readFileSync("src/components/recrutamento/FormulariosTela.tsx", "utf8");
    expect(editor).not.toContain("modelos-formularios");
    expect(editor).toContain("/api/recrutamento/formularios");
  });
});
