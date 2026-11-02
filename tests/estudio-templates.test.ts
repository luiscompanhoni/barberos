import { describe, expect, it } from "vitest";
import { validarCortes, zEdicao, zProjeto } from "@/lib/estudio/regras";
import { zImportarRoteiro } from "@/lib/estudio/roteiro-tipos";
import { formato } from "@/lib/estudio/templates";

describe("contratos fechados do Estúdio", () => {
  it("aceita décimos exatos sem relaxar duração mínima ou total", () => {
    expect(validarCortes([{ inicio: 0.2, fim: 0.3, duracao: 1 }])).toBe(true);
    expect(validarCortes([{ inicio: 0.2, fim: 0.299, duracao: 1 }])).toBe(false);
    expect(validarCortes([{ inicio: 0, fim: 120.001, duracao: 121 }])).toBe(false);
    expect(validarCortes([{ inicio: NaN, fim: 0.3, duracao: 1 }])).toBe(false);
  });
  it("não recebe origem ou aprovação forjadas pelo cliente", () => {
    expect(zProjeto.safeParse({ nome: "Teste", roteiro: {} }).success).toBe(false);
    expect(zEdicao.safeParse({ nome: "Teste", revisao: 0, clipes: [], origemExecucaoId: "forjado" }).success).toBe(false);
    expect(zImportarRoteiro.safeParse({ nome: "Teste", execucaoId: "abc", revisao: 1, resultadoHash: "f".repeat(64), aprovadoPorId: "forjado" }).success).toBe(false);
  });
  it("nega template arbitrário, título excedido e código como configuração", () => {
    expect(zProjeto.safeParse({ nome: "Teste", preset: "https://evil.test/template.html" }).success).toBe(false);
    expect(zEdicao.safeParse({ nome: "Teste", revisao: 0, clipes: [], titulo: "a".repeat(71) }).success).toBe(false);
    expect(() => formato("__proto__")).toThrow();
  });
  it("formato legado não é reinterpretado como 1080p", () => {
    expect(formato("black-vertical-v1")).toMatchObject({ largura: 720, altura: 1280 });
    for (const id of ["black-recrutamento-v2", "black-servicos-v2", "black-equipe-v2"]) expect(formato(id)).toMatchObject({ largura: 1080, altura: 1920 });
  });
});
