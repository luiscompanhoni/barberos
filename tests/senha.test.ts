import { describe, expect, it } from "vitest";
import { normalizarLogin } from "@/lib/auth/acesso";
import { conferirSenha, gerarHash, problemaDaSenha, senhaTemporaria } from "@/lib/auth/senha";

describe("senha", () => {
  it("hash confere so com a senha certa e e diferente a cada vez (salt)", async () => {
    const h1 = await gerarHash("Corte@2026");
    const h2 = await gerarHash("Corte@2026");
    expect(h1).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(h1).not.toBe(h2);
    expect(await conferirSenha("Corte@2026", h1)).toBe(true);
    expect(await conferirSenha("corte@2026", h1)).toBe(false);
    expect(await conferirSenha("Corte@2026", null)).toBe(false);
    expect(await conferirSenha("x", "lixo")).toBe(false);
  });
  it("recusa senha fraca", () => {
    expect(problemaDaSenha("1234567")).toMatch(/8 caracteres/);
    expect(problemaDaSenha("11111111")).toMatch(/fácil/);
    expect(problemaDaSenha("12345678")).toMatch(/fácil/);
    expect(problemaDaSenha("x88040047y", "5547988040047")).toMatch(/celular/);
    expect(problemaDaSenha("navalha-forte-9")).toBeNull();
  });
  it("senha temporaria legivel e suficiente", () => {
    const s = senhaTemporaria();
    expect(s).toMatch(/^[a-z]+-\d{4}-[a-z]+$/);
    expect(problemaDaSenha(s)).toBeNull();
  });
  it("nome de usuario", () => {
    expect(normalizarLogin(" Ygor ")).toBe("ygor");
    expect(normalizarLogin("ygor.silva")).toBe("ygor.silva");
    expect(normalizarLogin("47988040047")).toBeNull(); // comeca com numero: e celular, nao usuario
    expect(normalizarLogin("ab")).toBeNull();
  });
});
