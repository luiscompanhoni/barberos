import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
it("textos da aplicação preservam Unicode sem caracteres de substituição", () => {
  const ruins: string[] = [];
  function visitar(dir: string) {
    for (const e of readdirSync(dir, { withFileTypes:true })) {
      const p = join(dir,e.name);
      if (e.isDirectory()) visitar(p);
      else if (/\.(ts|tsx|css)$/.test(p) && /\uFFFD|\u001a/.test(readFileSync(p,"utf8"))) ruins.push(p);
    }
  }
  visitar("src");
  expect(ruins).toEqual([]);
  expect(readFileSync("src/app/(app)/recepcao/page.tsx","utf8")).toContain("Operação da Black");
});
