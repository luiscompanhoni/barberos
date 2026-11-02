import { describe, expect, it } from "vitest";
import { AGENTES, obterAgente } from "@/lib/agentes/catalogo";
import { promptAgente } from "@/lib/agentes/prompts";

describe("agentes: catálogo da barbearia", () => {
  it("resolve os 22 perfis e recusa identificadores fora do catálogo", () => {
    expect(AGENTES).toHaveLength(22);
    expect(new Set(AGENTES.map((a) => a.id)).size).toBe(22);
    for (const a of AGENTES) expect(obterAgente(a.id)).toBe(a);
    for (const id of ["", "DONO", "__proto__", "vendas_software", "TRAFEGO"]) {
      expect(() => obterAgente(id)).toThrow("Agente não encontrado.");
    }
  });

  it("encaminha apenas para especialidades existentes, sem duplicata ou autorreferência", () => {
    const ids = new Set<string>(AGENTES.map((a) => a.id));
    for (const a of AGENTES) {
      expect(a.proximos.length).toBeLessThanOrEqual(4);
      expect(new Set(a.proximos).size).toBe(a.proximos.length);
      for (const destino of a.proximos) {
        expect(ids.has(destino)).toBe(true);
        expect(destino).not.toBe(a.id);
      }
    }
  });

  it("preserva a trilha de marketing e a revisão antes de tráfego e alterações", () => {
    expect(obterAgente("estrategia").proximos).toContain("conteudo");
    expect(obterAgente("estrategia").proximos).not.toContain("trafego");
    expect(obterAgente("conteudo").proximos).toContain("trafego");
    expect(obterAgente("trafego").proximos).toContain("dados");
    expect(obterAgente("dados").proximos).toEqual(expect.arrayContaining(["estrategia", "conteudo", "trafego"]));
    expect(promptAgente("trafego")).toContain("aprovação humana da versão e orçamento");
    expect(promptAgente("dados")).toContain("a análise não altera gasto automaticamente");
  });

  it("mantém propostas e onboarding na operação da barbearia", () => {
    expect(obterAgente("propostas").instrucoes).toContain("parceria local");
    expect(obterAgente("onboarding").instrucoes).toContain("cliente, assinante ou colaborador");
    for (const a of AGENTES) {
      expect(`${a.objetivo} ${a.instrucoes}`).not.toMatch(/SaaS|vender (o )?software|venda de software|multiempresa/i);
    }
  });

  it("gera contrato estruturado e distingue recomendações de efeitos reais em todos os perfis", () => {
    for (const a of AGENTES) {
      const prompt = promptAgente(a.id);
      expect(prompt).toContain(a.instrucoes);
      expect(prompt).toContain(`DESTINOS PERMITIDOS: ${a.proximos.join(", ")}.`);
      expect(prompt).toContain("somente um objeto JSON válido");
      expect(prompt).toContain('"proximosPassos"');
      expect(prompt).toContain("não executa ações externas");
      expect(prompt).toContain("dados não confiáveis");
      expect(prompt).toContain("não é imagem gerada");
      expect(prompt).toContain("no máximo 4 itens");
    }
  });
});
