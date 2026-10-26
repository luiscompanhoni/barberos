import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

// Caractere de substituicao, SUB e mojibake de UTF-8 lido como Latin-1 (A-til ou A-circunflexo seguido de 0x80-0xBF).
// Escrito so com escapes para este arquivo nao acusar a si mesmo.
const QUEBRADO = /\uFFFD|\u001a|\u00C3[\u0080-\u00BF]|\u00C2[\u0080-\u00BF]/;

it("textos do projeto preservam Unicode, sem caracteres de substituição nem mojibake", () => {
  const ruins: string[] = [];
  function visitar(dir: string) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules") visitar(p); }
      else if (/\.(ts|tsx|css|mjs|cjs|sql|prisma)$/.test(p) && QUEBRADO.test(readFileSync(p, "utf8"))) ruins.push(p);
    }
  }
  for (const d of ["src", "scripts", "tests", "prisma"]) visitar(d);
  expect(ruins).toEqual([]);
  expect(readFileSync("src/app/(app)/recepcao/page.tsx", "utf8")).toContain("Operação da Black");
}, 30_000); // varre o repositorio: lento com a suite em paralelo

it("o detector pega os erros comuns de codificação", () => {
  for (const t of ["C\uFFFDdigo", "per\u00C3\u00ADodo", "a\u00C3\u00A7\u00C3\u00A3o", "x \u00C2\u00B7 y"]) expect(QUEBRADO.test(t)).toBe(true);
  for (const t of ["Código", "período", "ação", "SÃO PAULO", "x · y"]) expect(QUEBRADO.test(t)).toBe(false);
});
