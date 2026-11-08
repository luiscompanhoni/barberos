import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { conferirPixProtegido, decifrarChavePix, protegerChavePix, resumoPix } from "@/lib/rh/pix-protegido";
const segredo = Buffer.alloc(32, 71).toString("base64"); // Fixture sem valor fora destes testes.
beforeEach(() => vi.stubEnv("RH_PIX_ENCRYPTION_KEY", segredo));
afterEach(() => vi.unstubAllEnvs());

describe("proteção de dados Pix sem revelar chave ou segredo", () => {
  it("cifra com nonce aleatório, vínculo da pessoa e restauração exata", () => {
    const a = protegerChavePix("p1", "Pessoa@Example.com"), b = protegerChavePix("p1", "Pessoa@Example.com");
    expect(a.chavePix).toBeNull(); expect(a.chavePixCifrada).not.toBe(b.chavePixCifrada);
    expect(a.chavePixHash).toBe(b.chavePixHash); expect(JSON.stringify(a)).not.toContain("Pessoa@Example.com");
    expect(decifrarChavePix("p1", a.chavePixCifrada!)).toBe("pessoa@example.com");
    expect(conferirPixProtegido("p1", a).problema).toBeNull();
    expect(a.chavePixHash).not.toBe(createHash("sha256").update("pessoa@example.com").digest("hex"));
  });
  it("não permite mover um ciphertext para outro profissional", () => {
    const a = protegerChavePix("p1", "pessoa@example.com");
    expect(() => decifrarChavePix("p2", a.chavePixCifrada!)).toThrow();
    expect(conferirPixProtegido("p2", a).problema).toBeTruthy();
  });
  it("adulteração, metadados alterados e segredo diferente bloqueiam conferência", () => {
    const a = protegerChavePix("p1", "pessoa@example.com");
    const partes = a.chavePixCifrada!.split(":"); partes[2] = (partes[2][0] === "A" ? "B" : "A") + partes[2].slice(1);
    expect(() => decifrarChavePix("p1", partes.join(":"))).toThrow();
    expect(conferirPixProtegido("p1", { ...a, chavePixMascarada: "••••0000" }).problema).toBeTruthy();
    vi.stubEnv("RH_PIX_ENCRYPTION_KEY", Buffer.alloc(32, 72).toString("base64"));
    expect(conferirPixProtegido("p1", a).problema).toBeTruthy();
  });
  it.each(["", "fixture-curta", Buffer.alloc(16).toString("base64"), "!".repeat(44)])("não grava com segredo ausente/inválido %#", valor => {
    vi.stubEnv("RH_PIX_ENCRYPTION_KEY", valor);
    expect(() => protegerChavePix("p1", "pessoa@example.com")).toThrow("indisponível");
  });
  it("cadastro legado permanece mascarado e não fica conferível sem migração", () => {
    vi.stubEnv("RH_PIX_ENCRYPTION_KEY", "");
    const resumo = resumoPix({ chavePix: "pessoa@example.com" });
    expect(resumo).toMatchObject({ estado: "LEGADO_PENDENTE", mascara: "••••.com" });
    expect(JSON.stringify(resumo)).not.toContain("pessoa@example.com");
    expect(conferirPixProtegido("p1", { chavePix: "pessoa@example.com" }).problema).toBeTruthy();
  });
  it("exclusão explícita não exige segredo nem inventa chave nova", () => {
    vi.stubEnv("RH_PIX_ENCRYPTION_KEY", "");
    expect(protegerChavePix("p1", null)).toEqual({ chavePix: null, chavePixCifrada: null, chavePixMascarada: null, chavePixTipo: null, chavePixHash: null });
  });
  it.each(["", "pessoa@", "47999990000"])("rejeita chave inválida antes de criar cifra: %s", valor => {
    expect(() => protegerChavePix("p1", valor)).toThrow();
  });
});
