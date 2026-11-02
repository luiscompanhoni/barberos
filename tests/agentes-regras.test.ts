import { describe, expect, it } from "vitest";
import { conferirResultado, conferirRevisao, hashAgente, zRotinaAgente } from "@/lib/agentes/regras";
import { destinoAutomatico } from "@/lib/agentes/encaminhamentos";

const base = { resumo: "Análise concluída", entregaveis: ["Rascunho"], alertas: [], proximosPassos: [] };
describe("fronteiras da central", () => {
  it("recusa ferramenta ou aprovação inventada pelo modelo", () => {
    expect(() => conferirResultado("estrategia", { ...base, aprovado: true })).toThrow();
    expect(() => conferirResultado("estrategia", { ...base, proximosPassos: [{ agenteId: "cobranca", tarefa: "Cobrar automaticamente todos os clientes" }] })).toThrow();
  });
  it("recusa destinos repetidos, autoencaminhamento e identidade inexistente", () => {
    const item = { agenteId: "conteudo", tarefa: "Preparar uma versão para revisão" };
    expect(() => conferirResultado("estrategia", { ...base, proximosPassos: [item, item] })).toThrow();
    expect(() => conferirResultado("estrategia", { ...base, proximosPassos: [{ ...item, agenteId: "estrategia" }] })).toThrow();
    expect(() => conferirResultado("estrategia", { ...base, proximosPassos: [{ ...item, agenteId: "invasor" }] })).toThrow();
  });
  it("não confunde aprovação antiga com a revisão atual", () => {
    expect(() => conferirRevisao(2, 1)).toThrow(/mudou/);
    expect(hashAgente(base)).not.toBe(hashAgente({ ...base, resumo: "Outro conteúdo" }));
    expect(hashAgente({ b: 2, a: { y: 1, x: 0 } })).toBe(hashAgente({ a: { x: 0, y: 1 }, b: 2 }));
  });
  it("rotinas exigem intervalo limitado e começam inativas", () => {
    const p = { nome: "Resumo diário", agenteId: "assistente", tarefa: "Resumir as pendências da operação", chave: "rotina-chave" };
    expect(zRotinaAgente.parse({ ...p, cadaMinutos: 1440 }).ativa).toBe(false);
    expect(() => zRotinaAgente.parse({ ...p, cadaMinutos: 1 })).toThrow();
  });
  it("automatiza só a preparação limitada e preserva a aprovação antes do tráfego", () => {
    expect(destinoAutomatico("dados", 0)).toBe("estrategia");
    expect(destinoAutomatico("estrategia", 1)).toBe("conteudo");
    for (const id of ["conteudo", "trafego", "email", "cobranca", "whatsapp"]) expect(destinoAutomatico(id, 0)).toBeNull();
    expect(destinoAutomatico("dados", 2)).toBeNull();
  });
});
